import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GenerateIdpSigningCertRequestDto, StoredSigningCrypto } from '@nestidp/shared';
import {
	daysFromTodayUntilNotAfter,
	ecCurveToNamedCurve,
	resolveGenerateIdpSigningCertRequest,
	resolveSignatureAlgorithmIdForSigning,
	toStoredSigningCrypto,
} from '@nestidp/shared';
import { SignedXml } from 'xml-crypto';
import { runOpenssl } from '../utils/openssl.util';
import { applyNestIdpXmlCryptoExtensions } from '../xml-crypto-extended-algorithms';
import { EncryptionService } from '../../encryption/services/encryption.service';
import { invalidateIdpSettingsCache } from '../../idp-settings/utils/idp-settings-cache.util';
import { PrismaService } from '../../prisma/services/prisma.service';
import { SamlAuthAuditService } from './saml-auth-audit.service';

export interface SigningMaterial {
	certPem: string;
	privateKeyPem: string;
	signatureAlgorithmId?: string | null;
}

export interface GeneratedSigningKeyPair {
	privateKeyPem: string;
	certPem: string;
	metadata: StoredSigningCrypto;
}

@Injectable()
export class IdpSigningService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly encryptionService: EncryptionService,
		private readonly configService: ConfigService,
		private readonly audit: SamlAuthAuditService,
	) {}

	async ensureSigningMaterial(): Promise<SigningMaterial> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		if (!settings) {
			throw new Error('IdP settings not configured');
		}

		if (settings.signingCertPem && settings.signingKeyEncrypted) {
			return {
				certPem: settings.signingCertPem,
				privateKeyPem: this.encryptionService.decrypt(settings.signingKeyEncrypted),
				signatureAlgorithmId: settings.signingSignatureAlgorithmId,
			};
		}

		if (settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted) {
			throw new Error('IdP signing certificate not configured');
		}

		const generated = this.generateKeyPairAndCert(settings.entityId);
		// §14: atomic conditional claim — two concurrent first-use callers must not both persist
		// material (the loser's published cert would not match the winner's signing key). Only the
		// caller that still sees an empty slot writes; the loser re-reads and uses the winner's pair.
		const claimed = await this.prisma.idpSettings.updateMany({
			where: { id: 'default', signingCertPem: null, signingKeyEncrypted: null },
			data: {
				signingCertPem: generated.certPem,
				signingKeyEncrypted: this.encryptionService.encrypt(generated.privateKeyPem),
				signingKeyFamily: generated.metadata.signingKeyFamily,
				signingSignatureAlgorithmId: generated.metadata.signingSignatureAlgorithmId,
				signingRsaModulusBits: generated.metadata.signingRsaModulusBits,
				signingEcCurve: generated.metadata.signingEcCurve,
			},
		});
		if (claimed.count === 0) {
			return this.ensureSigningMaterial();
		}
		invalidateIdpSettingsCache(this.prisma);
		this.audit.logSigningKeyGenerated();
		return {
			certPem: generated.certPem,
			privateKeyPem: generated.privateKeyPem,
			signatureAlgorithmId: generated.metadata.signingSignatureAlgorithmId,
		};
	}

	signAssertion(assertionXml: string, material: SigningMaterial, assertionId: string): string {
		const option = resolveSignatureAlgorithmIdForSigning(material.signatureAlgorithmId);
		const sig = new SignedXml({
			privateKey: material.privateKeyPem,
			publicCert: material.certPem,
			signatureAlgorithm: option.xmlSignatureAlgorithm,
			canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
		});
		applyNestIdpXmlCryptoExtensions(sig);
		const stripped = assertionXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
		const wrapper = `<container>${stripped}</container>`;
		sig.addReference({
			xpath: `//*[@ID='${assertionId}']`,
			transforms: [
				'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
				'http://www.w3.org/2001/10/xml-exc-c14n#',
			],
			digestAlgorithm: option.xmlDigestAlgorithm,
		});
		sig.computeSignature(wrapper, {
			location: { reference: `//*[@ID='${assertionId}']`, action: 'after' },
		});
		// SECURITY: never fall back to the unsigned assertion. If signing or fragment extraction fails we
		// must reject — emitting an unsigned assertion would let an attacker strip the signature silently.
		const signedWrapper = sig.getSignedXml();
		if (!signedWrapper) {
			throw new Error('Failed to sign SAML assertion (empty signed output)');
		}
		const fragment = this.extractSignedAssertionFragment(signedWrapper);
		if (!fragment) {
			throw new Error('Failed to extract the signed SAML assertion fragment');
		}
		return fragment;
	}

	/**
	 * Sign a `<samlp:LogoutResponse>` (or other SAML protocol message) at the root
	 * with an enveloped XML-DSig. The `<ds:Signature>` is inserted directly after the
	 * `<saml2:Issuer>` element, per the SAML schema sequence (Issuer, Signature, Status).
	 */
	signLogoutResponse(messageXml: string, material: SigningMaterial, messageId: string): string {
		const option = resolveSignatureAlgorithmIdForSigning(material.signatureAlgorithmId);
		const sig = new SignedXml({
			privateKey: material.privateKeyPem,
			publicCert: material.certPem,
			signatureAlgorithm: option.xmlSignatureAlgorithm,
			canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
		});
		applyNestIdpXmlCryptoExtensions(sig);
		const stripped = messageXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
		sig.addReference({
			xpath: `//*[@ID='${messageId}']`,
			transforms: [
				'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
				'http://www.w3.org/2001/10/xml-exc-c14n#',
			],
			digestAlgorithm: option.xmlDigestAlgorithm,
		});
		sig.computeSignature(stripped, {
			location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
		});
		return sig.getSignedXml() ?? stripped;
	}

	/**
	 * Sign an outbound `<samlp:LogoutRequest>` for the back-channel SOAP SLO (Prompt 36). Same enveloped
	 * XML-DSig path as {@link signLogoutResponse} — the `<ds:Signature>` goes after `<saml2:Issuer>`, valid
	 * for the LogoutRequest schema sequence (Issuer, Signature, …).
	 */
	signLogoutRequest(messageXml: string, material: SigningMaterial, messageId: string): string {
		return this.signLogoutResponse(messageXml, material, messageId);
	}

	async hasSigningMaterial(): Promise<boolean> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		return Boolean(settings?.signingCertPem && settings?.signingKeyEncrypted);
	}

	async getMetadataSigningCertificates(): Promise<string[]> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		if (!settings) {
			throw new Error('IdP settings not configured');
		}

		const certs: string[] = [];
		if (settings.signingCertPem) {
			certs.push(settings.signingCertPem);
		}
		if (settings.pendingSigningCertPem) {
			certs.push(settings.pendingSigningCertPem);
		}
		if (certs.length > 0) {
			return certs;
		}

		const material = await this.ensureSigningMaterial();
		return [material.certPem];
	}

	generateKeyPairAndCert(
		entityId: string,
		options?: GenerateIdpSigningCertRequestDto,
	): GeneratedSigningKeyPair {
		return this.createKeyPairAndCert(entityId, options);
	}

	extractX509CertificatePem(certPem: string): string {
		return certPem
			.replace(/-----BEGIN CERTIFICATE-----/g, '')
			.replace(/-----END CERTIFICATE-----/g, '')
			.replace(/\s+/g, '');
	}

	private extractSignedAssertionFragment(signedWrapper: string): string | null {
		const start = signedWrapper.indexOf('<saml2:Assertion');
		const assertionEnd = signedWrapper.indexOf('</saml2:Assertion>');
		if (start < 0 || assertionEnd < 0) {
			return null;
		}
		let fragment = signedWrapper.slice(start, assertionEnd + '</saml2:Assertion>'.length);
		const after = signedWrapper.slice(assertionEnd + '</saml2:Assertion>'.length);
		const sigMatch = after.match(/<(?:[\w-]+:)?Signature[\s\S]*?<\/(?:[\w-]+:)?Signature>/);
		if (sigMatch) {
			fragment += sigMatch[0];
		}
		return fragment;
	}

	private createKeyPairAndCert(
		entityId: string,
		options?: GenerateIdpSigningCertRequestDto,
	): GeneratedSigningKeyPair {
		const resolved = resolveGenerateIdpSigningCertRequest(options ?? {});
		const metadata = toStoredSigningCrypto(resolved);

		const privateKeyPem =
			resolved.keyFamily === 'rsa'
				? generateKeyPairSync('rsa', {
						modulusLength: resolved.rsaModulusBits,
						privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
						publicKeyEncoding: { type: 'spki', format: 'pem' },
					}).privateKey
				: generateKeyPairSync('ec', {
						namedCurve: ecCurveToNamedCurve(resolved.ecCurve),
						privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
						publicKeyEncoding: { type: 'spki', format: 'pem' },
					}).privateKey;

		const tmp = mkdtempSync(join(tmpdir(), 'nestidp-cert-'));
		try {
			const keyPath = join(tmp, 'key.pem');
			const certPath = join(tmp, 'cert.pem');
			writeFileSync(keyPath, privateKeyPem);
			const cn = entityId.replace(/^https?:\/\//, '').slice(0, 64) || 'nestidp';
			const days = daysFromTodayUntilNotAfter(resolved.notAfter);
			// SECURITY: never interpolate operator-controlled values (entityId → cn) into a shell command
			// string. spawnSync with an args array and no shell passes `/CN=${cn}` as a single literal argv
			// element, so shell metacharacters in entityId cannot inject commands.
			runOpenssl([
				'req',
				'-new',
				'-x509',
				'-key',
				keyPath,
				'-out',
				certPath,
				'-days',
				String(days),
				'-subj',
				`/CN=${cn}`,
				'-nodes',
			]);
			return {
				privateKeyPem,
				certPem: readFileSync(certPath, 'utf8'),
				metadata,
			};
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}
}
