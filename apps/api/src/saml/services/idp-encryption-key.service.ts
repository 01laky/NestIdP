import { Injectable } from '@nestjs/common';
import { IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID } from '@nestidp/shared';
import { EncryptionService } from '../../encryption/services/encryption.service';
import { PrismaService } from '../../prisma/services/prisma.service';

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
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
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
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		if (!settings?.encryptionCertPem || !settings.encryptionKeyEncrypted) {
			return false;
		}
		return settings.encryptionKeyFamily === 'ec';
	}
}
