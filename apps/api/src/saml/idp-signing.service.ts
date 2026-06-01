import { execSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignedXml } from 'xml-crypto';
import { EncryptionService } from '../encryption/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { SamlAuthAuditService } from './saml-auth-audit.service';

export interface SigningMaterial {
	certPem: string;
	privateKeyPem: string;
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
			};
		}

		const { privateKeyPem, certPem } = this.generateKeyPairAndCert(settings.entityId);
		await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: certPem,
				signingKeyEncrypted: this.encryptionService.encrypt(privateKeyPem),
			},
		});
		this.audit.logSigningKeyGenerated();
		return { certPem, privateKeyPem };
	}

	signAssertion(assertionXml: string, material: SigningMaterial, assertionId: string): string {
		const sig = new SignedXml({
			privateKey: material.privateKeyPem,
			publicCert: material.certPem,
			signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
			canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
		});
		const stripped = assertionXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
		const wrapper = `<container>${stripped}</container>`;
		sig.addReference({
			xpath: `//*[@ID='${assertionId}']`,
			transforms: [
				'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
				'http://www.w3.org/2001/10/xml-exc-c14n#',
			],
			digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
		});
		sig.computeSignature(wrapper, {
			location: { reference: `//*[@ID='${assertionId}']`, action: 'after' },
		});
		const signedWrapper = sig.getSignedXml() ?? wrapper;
		return this.extractSignedAssertionFragment(signedWrapper) ?? stripped;
	}

	async hasSigningMaterial(): Promise<boolean> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		return Boolean(settings?.signingCertPem && settings?.signingKeyEncrypted);
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

	private generateKeyPairAndCert(entityId: string): { privateKeyPem: string; certPem: string } {
		const { privateKey } = generateKeyPairSync('rsa', {
			modulusLength: 2048,
			privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
			publicKeyEncoding: { type: 'spki', format: 'pem' },
		});

		const tmp = mkdtempSync(join(tmpdir(), 'nestidp-cert-'));
		try {
			const keyPath = join(tmp, 'key.pem');
			const certPath = join(tmp, 'cert.pem');
			writeFileSync(keyPath, privateKey);
			const cn = entityId.replace(/^https?:\/\//, '').slice(0, 64) || 'nestidp';
			execSync(
				`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 3650 -subj "/CN=${cn}" -nodes`,
				{ stdio: 'pipe' },
			);
			return {
				privateKeyPem: privateKey,
				certPem: readFileSync(certPath, 'utf8'),
			};
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}
}
