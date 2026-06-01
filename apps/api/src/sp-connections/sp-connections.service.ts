import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
	CreateSpConnectionRequestDto,
	DeleteSpConnectionResponseDto,
	IdpMetadataUrlResponseDto,
	SpConnectionListResponseDto,
	SpConnectionPublicDto,
	SpConnectionResponseDto,
	UpdateSpConnectionRequestDto,
} from '@nestidp/shared';
import { SAML_METADATA_PATH, SAML_NAME_ID_FORMATS, SAML_SSO_PATH } from '@nestidp/shared';
import { assertValidAcsUrl, AcsUrlValidationError } from '../common/acs-url.util';
import { PrismaService } from '../prisma/prisma.service';
import {
	assertValidSpAttributeMapping,
	SpAttributeMappingValidationError,
} from './sp-attribute-mapping.validator';
import { assertValidSpCertificatePem, SpCertificateValidationError } from './sp-certificate.util';
import { SpConnectionsAuditService } from './sp-connections-audit.service';
import { toSpConnectionPublicDto } from './sp-connections.mapper';

@Injectable()
export class SpConnectionsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly audit: SpConnectionsAuditService,
	) {}

	async list(): Promise<SpConnectionListResponseDto> {
		const rows = await this.prisma.spConnection.findMany({ orderBy: { createdAt: 'asc' } });
		return { items: rows.map(toSpConnectionPublicDto) };
	}

	async getById(id: string): Promise<SpConnectionPublicDto> {
		const row = await this.findOrThrow(id);
		return toSpConnectionPublicDto(row);
	}

	async create(body: CreateSpConnectionRequestDto): Promise<SpConnectionResponseDto> {
		await this.assertNameAvailable(body.name);
		const spEntityId = body.spEntityId.trim();
		await this.assertEntityIdAvailable(spEntityId);

		const acsUrl = this.validateAcsUrl(body.acsUrl);
		const nameIdFormat = this.resolveNameIdFormat(body.nameIdFormat);
		const attributeMapping = this.validateMapping(body.attributeMapping);
		const spCertificate = this.validateCertificate(body.spCertificate);

		const row = await this.prisma.spConnection.create({
			data: {
				name: body.name.trim(),
				spEntityId,
				acsUrl,
				nameIdFormat,
				attributeMapping: attributeMapping ?? Prisma.JsonNull,
				active: body.active ?? true,
				spCertificate,
			},
		});

		this.audit.logCreated(row.id, row.spEntityId);
		return { item: toSpConnectionPublicDto(row) };
	}

	async update(id: string, body: UpdateSpConnectionRequestDto): Promise<SpConnectionResponseDto> {
		if (
			body.name === undefined &&
			body.spEntityId === undefined &&
			body.acsUrl === undefined &&
			body.nameIdFormat === undefined &&
			body.attributeMapping === undefined &&
			body.active === undefined &&
			body.spCertificate === undefined
		) {
			throw new BadRequestException('At least one field must be provided');
		}

		const existing = await this.findOrThrow(id);

		if (body.name !== undefined) {
			if (body.name.trim().length === 0) {
				throw new BadRequestException('name must not be empty');
			}
			await this.assertNameAvailable(body.name, id);
		}

		if (body.spEntityId !== undefined) {
			if (body.spEntityId.trim().length === 0) {
				throw new BadRequestException('spEntityId must not be empty');
			}
			await this.assertEntityIdAvailable(body.spEntityId.trim(), id);
		}

		const data: Prisma.SpConnectionUpdateInput = {};

		if (body.name !== undefined) {
			data.name = body.name.trim();
		}
		if (body.spEntityId !== undefined) {
			data.spEntityId = body.spEntityId.trim();
		}
		if (body.acsUrl !== undefined) {
			data.acsUrl = this.validateAcsUrl(body.acsUrl);
		}
		if (body.nameIdFormat !== undefined) {
			data.nameIdFormat = this.resolveNameIdFormat(body.nameIdFormat);
		}
		if (body.attributeMapping !== undefined) {
			const mapping = this.validateMapping(body.attributeMapping);
			data.attributeMapping = mapping === null ? Prisma.JsonNull : mapping;
		}
		if (body.active !== undefined) {
			data.active = body.active;
		}
		if (body.spCertificate !== undefined) {
			data.spCertificate = this.validateCertificate(body.spCertificate);
		}

		const row = await this.prisma.spConnection.update({
			where: { id: existing.id },
			data,
		});

		this.audit.logUpdated(row.id, row.spEntityId);
		return { item: toSpConnectionPublicDto(row) };
	}

	async delete(id: string): Promise<DeleteSpConnectionResponseDto> {
		const existing = await this.findOrThrow(id);
		await this.prisma.spConnection.delete({ where: { id } });
		this.audit.logDeleted(existing.id, existing.spEntityId);
		return { ok: true, id };
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

	private async findOrThrow(id: string) {
		const row = await this.prisma.spConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('Service Provider connection not found');
		}
		return row;
	}

	private validateAcsUrl(raw: string): string {
		try {
			return assertValidAcsUrl(raw, this.configService.get<string>('NODE_ENV') ?? 'development');
		} catch (error) {
			if (error instanceof AcsUrlValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	private validateMapping(value: SpConnectionPublicDto['attributeMapping'] | null | undefined) {
		try {
			return assertValidSpAttributeMapping(value ?? null);
		} catch (error) {
			if (error instanceof SpAttributeMappingValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	private validateCertificate(value: string | null | undefined): string | null {
		try {
			return assertValidSpCertificatePem(value);
		} catch (error) {
			if (error instanceof SpCertificateValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	private resolveNameIdFormat(format: string | undefined): string {
		if (!format || format.trim().length === 0) {
			return 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
		}
		const trimmed = format.trim();
		if ((SAML_NAME_ID_FORMATS as readonly string[]).includes(trimmed)) {
			return trimmed;
		}
		if (trimmed.startsWith('urn:') && trimmed.length <= 512) {
			return trimmed;
		}
		throw new BadRequestException('Invalid nameIdFormat');
	}

	private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
		const normalized = name.trim().toLowerCase();
		const rows = await this.prisma.spConnection.findMany({
			where: excludeId ? { id: { not: excludeId } } : undefined,
			select: { name: true },
		});
		if (rows.some((row) => row.name.trim().toLowerCase() === normalized)) {
			throw new ConflictException('A Service Provider connection with this name already exists');
		}
	}

	private async assertEntityIdAvailable(spEntityId: string, excludeId?: string): Promise<void> {
		const existing = await this.prisma.spConnection.findUnique({
			where: { spEntityId },
		});
		if (existing && existing.id !== excludeId) {
			throw new ConflictException('spEntityId already exists');
		}
	}
}
