import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IdpMetadataUrlResponseDto, SpConnectionListResponseDto } from '@nestidp/shared';
import { SAML_METADATA_PATH, SAML_SSO_PATH } from '@nestidp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toSpConnectionPublicDto } from './sp-connections.mapper';

@Injectable()
export class SpConnectionsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	async list(): Promise<SpConnectionListResponseDto> {
		const rows = await this.prisma.spConnection.findMany({ orderBy: { createdAt: 'asc' } });
		return { items: rows.map(toSpConnectionPublicDto) };
	}

	async getById(id: string): Promise<SpConnectionListResponseDto['items'][number]> {
		const row = await this.prisma.spConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('Service Provider connection not found');
		}
		return toSpConnectionPublicDto(row);
	}

	async getMetadataUrl(): Promise<IdpMetadataUrlResponseDto> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		if (!settings) {
			throw new NotFoundException('IdP settings not configured');
		}
		const base = (this.configService.get<string>('IDP_BASE_URL') ?? '').replace(/\/+$/, '');
		return {
			metadataUrl: `${base}${SAML_METADATA_PATH}`,
			entityId: settings.entityId,
			ssoUrl: `${base}${SAML_SSO_PATH}`,
		};
	}
}
