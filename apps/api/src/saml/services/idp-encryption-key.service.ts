import { Injectable } from '@nestjs/common';
import { IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID } from '@nestidp/shared';
import { EncryptionService } from '../../encryption/services/encryption.service';
import { PrismaService } from '../../prisma/services/prisma.service';
import { getCachedIdpSettings } from '../../idp-settings/utils/idp-settings-cache.util';

export interface IdpDecryptionMaterial {
	privateKeyPem: string;
	keyTransportAlgorithmId: string;
}

@Injectable()
export class IdpEncryptionKeyService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly encryptionService: EncryptionService,
	) {}

	async getDecryptionMaterial(): Promise<IdpDecryptionMaterial[]> {
		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings) {
			return [];
		}

		const materials: IdpDecryptionMaterial[] = [];

		if (settings.encryptionKeyEncrypted && settings.encryptionCertPem) {
			if (settings.encryptionKeyFamily === 'ec') {
				return [];
			}
			materials.push({
				privateKeyPem: this.encryptionService.decrypt(settings.encryptionKeyEncrypted),
				keyTransportAlgorithmId:
					settings.encryptionKeyTransportAlgorithmId ??
					IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
			});
		}

		if (
			settings.pendingEncryptionKeyEncrypted &&
			settings.pendingEncryptionCertPem &&
			settings.encryptionRotationStartedAt
		) {
			if (settings.pendingEncryptionKeyFamily !== 'ec') {
				materials.push({
					privateKeyPem: this.encryptionService.decrypt(settings.pendingEncryptionKeyEncrypted),
					keyTransportAlgorithmId:
						settings.pendingEncryptionKeyTransportAlgorithmId ??
						IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
				});
			}
		}

		return materials;
	}

	async hasEcEncryptionKey(): Promise<boolean> {
		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings?.encryptionCertPem || !settings.encryptionKeyEncrypted) {
			return false;
		}
		return settings.encryptionKeyFamily === 'ec';
	}

	async isPrimaryKeyEc(): Promise<boolean> {
		return this.hasEcEncryptionKey();
	}

	async getEcDecryptionMaterial(): Promise<Array<{ privateKeyPem: string; ecCurve: string }>> {
		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings) {
			return [];
		}
		const materials: Array<{ privateKeyPem: string; ecCurve: string }> = [];

		if (
			settings.encryptionKeyEncrypted &&
			settings.encryptionCertPem &&
			settings.encryptionKeyFamily === 'ec' &&
			settings.encryptionEcCurve
		) {
			materials.push({
				privateKeyPem: this.encryptionService.decrypt(settings.encryptionKeyEncrypted),
				ecCurve: settings.encryptionEcCurve,
			});
		}

		if (
			settings.pendingEncryptionKeyEncrypted &&
			settings.pendingEncryptionCertPem &&
			settings.encryptionRotationStartedAt &&
			settings.pendingEncryptionKeyFamily === 'ec' &&
			settings.pendingEncryptionEcCurve
		) {
			materials.push({
				privateKeyPem: this.encryptionService.decrypt(settings.pendingEncryptionKeyEncrypted),
				ecCurve: settings.pendingEncryptionEcCurve,
			});
		}

		return materials;
	}

	async getRsaDecryptionMaterial(): Promise<IdpDecryptionMaterial[]> {
		const settings = await getCachedIdpSettings(this.prisma);
		if (!settings) {
			return [];
		}
		const materials: IdpDecryptionMaterial[] = [];

		if (
			settings.encryptionKeyEncrypted &&
			settings.encryptionCertPem &&
			settings.encryptionKeyFamily !== 'ec'
		) {
			materials.push({
				privateKeyPem: this.encryptionService.decrypt(settings.encryptionKeyEncrypted),
				keyTransportAlgorithmId:
					settings.encryptionKeyTransportAlgorithmId ??
					IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
			});
		}

		if (
			settings.pendingEncryptionKeyEncrypted &&
			settings.pendingEncryptionCertPem &&
			settings.encryptionRotationStartedAt &&
			settings.pendingEncryptionKeyFamily !== 'ec'
		) {
			materials.push({
				privateKeyPem: this.encryptionService.decrypt(settings.pendingEncryptionKeyEncrypted),
				keyTransportAlgorithmId:
					settings.pendingEncryptionKeyTransportAlgorithmId ??
					IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
			});
		}

		return materials;
	}
}
