import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { GenerateIdpEncryptionCertRequestDto, StoredEncryptionCrypto } from '@nestidp/shared';
import {
	daysFromTodayUntilNotAfter,
	ecCurveToNamedCurve,
	resolveGenerateIdpEncryptionCertRequest,
	toStoredEncryptionCrypto,
} from '@nestidp/shared';
import { runOpenssl } from '../utils/openssl.util';
import { PrismaService } from '../../prisma/services/prisma.service';

export interface GeneratedEncryptionKeyPair {
	privateKeyPem: string;
	certPem: string;
	metadata: StoredEncryptionCrypto;
}

@Injectable()
export class IdpEncryptionService {
	constructor(private readonly prisma: PrismaService) {}

	async getMetadataEncryptionCertificates(): Promise<string[]> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		if (!settings) {
			throw new Error('IdP settings not configured');
		}

		const certs: string[] = [];
		if (settings.encryptionCertPem) {
			certs.push(settings.encryptionCertPem);
		}
		if (settings.pendingEncryptionCertPem) {
			certs.push(settings.pendingEncryptionCertPem);
		}
		return certs;
	}

	generateKeyPairAndCert(
		entityId: string,
		options?: GenerateIdpEncryptionCertRequestDto,
	): GeneratedEncryptionKeyPair {
		const resolved = resolveGenerateIdpEncryptionCertRequest(options ?? {});
		const metadata = toStoredEncryptionCrypto(resolved);

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

		const tmp = mkdtempSync(join(tmpdir(), 'nestidp-enc-cert-'));
		try {
			const keyPath = join(tmp, 'key.pem');
			const certPath = join(tmp, 'cert.pem');
			writeFileSync(keyPath, privateKeyPem);
			const cn = entityId.replace(/^https?:\/\//, '').slice(0, 64) || 'nestidp';
			const days = daysFromTodayUntilNotAfter(resolved.notAfter);
			// SECURITY: args array + no shell — operator-controlled `cn` cannot inject a command. See openssl.util.
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
				'-addext',
				'keyUsage=keyEncipherment,dataEncipherment',
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

	extractX509CertificatePem(certPem: string): string {
		return certPem
			.replace(/-----BEGIN CERTIFICATE-----/g, '')
			.replace(/-----END CERTIFICATE-----/g, '')
			.replace(/\s+/g, '');
	}
}
