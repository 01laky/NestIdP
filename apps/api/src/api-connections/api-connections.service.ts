import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
	ApiConnectionListResponseDto,
	ApiConnectionResponseDto,
	CreateApiConnectionRequestDto,
	DeleteApiConnectionResponseDto,
	UpdateApiConnectionRequestDto,
} from '@nestidp/shared';
import { NodeEnv } from '../config/env.validation';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../encryption/credentials-encryption.port';
import { PrismaService } from '../prisma/prisma.service';
import { assertValidBaseUrl, BaseUrlValidationError } from './base-url.util';
import { ApiConnectionsAuditService } from './api-connections-audit.service';
import { toApiConnectionDto } from './api-connections.mapper';

@Injectable()
export class ApiConnectionsService {
	private readonly logger = new Logger(ApiConnectionsService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly configService: ConfigService,
		private readonly audit: ApiConnectionsAuditService,
	) {}

	async list(): Promise<ApiConnectionListResponseDto> {
		const rows = await this.prisma.apiConnection.findMany({
			where: { isLocalDirectory: false },
			orderBy: { createdAt: 'asc' },
		});
		return { connections: rows.map(toApiConnectionDto) };
	}

	async getById(id: string): Promise<ApiConnectionResponseDto> {
		const row = await this.findOrThrow(id);
		return { connection: toApiConnectionDto(row) };
	}

	async create(body: CreateApiConnectionRequestDto): Promise<ApiConnectionResponseDto> {
		const count = await this.prisma.apiConnection.count({
			where: { isLocalDirectory: false },
		});
		if (count >= 1) {
			throw new ConflictException('Only one API connection is supported in v1');
		}

		await this.assertNameAvailable(body.name);

		const baseUrl = this.validateBaseUrl(body.baseUrl);
		const authCredentialsEncrypted = this.encryption.encrypt(body.bearerToken);

		const row = await this.prisma.apiConnection.create({
			data: {
				name: body.name.trim(),
				baseUrl,
				authType: 'BEARER',
				authCredentialsEncrypted,
			},
		});

		return { connection: toApiConnectionDto(row) };
	}

	async update(id: string, body: UpdateApiConnectionRequestDto): Promise<ApiConnectionResponseDto> {
		if (!body.name && !body.baseUrl && body.bearerToken === undefined) {
			throw new BadRequestException('At least one field must be provided');
		}

		const existing = await this.findOrThrow(id);

		if (body.name !== undefined) {
			if (body.name.trim().length === 0) {
				throw new BadRequestException('name must not be empty');
			}
			await this.assertNameAvailable(body.name, id);
		}

		const data: Prisma.ApiConnectionUpdateInput = {};

		if (body.name !== undefined) {
			data.name = body.name.trim();
		}

		if (body.baseUrl !== undefined) {
			data.baseUrl = this.validateBaseUrl(body.baseUrl);
		}

		if (body.bearerToken !== undefined) {
			if (body.bearerToken.length === 0) {
				throw new BadRequestException('bearerToken must not be empty');
			}
			data.authCredentialsEncrypted = this.encryption.encrypt(body.bearerToken);
		}

		const row = await this.prisma.apiConnection.update({
			where: { id: existing.id },
			data,
		});

		this.audit.logUpdated(row.id, row.name);
		return { connection: toApiConnectionDto(row) };
	}

	async delete(id: string): Promise<DeleteApiConnectionResponseDto> {
		const existing = await this.findOrThrow(id);
		try {
			await this.prisma.apiConnection.delete({ where: { id } });
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
				throw new ConflictException('Cannot delete API connection with synced identity data');
			}
			throw error;
		}
		this.audit.logDeleted(existing.id, existing.name);
		return { ok: true, id };
	}

	private async findOrThrow(id: string) {
		const row = await this.prisma.apiConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('API connection not found');
		}
		if (row.isLocalDirectory) {
			throw new ForbiddenException('Local directory connection cannot be modified');
		}
		return row;
	}

	private validateBaseUrl(raw: string): string {
		try {
			return assertValidBaseUrl(raw, {
				requireHttps: this.configService.get<string>('NODE_ENV') === NodeEnv.Production,
			});
		} catch (error) {
			if (error instanceof BaseUrlValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
		const normalized = name.trim().toLowerCase();
		const existing = await this.prisma.apiConnection.findMany({
			where: excludeId ? { id: { not: excludeId } } : undefined,
			select: { id: true, name: true },
		});
		if (existing.some((row) => row.name.trim().toLowerCase() === normalized)) {
			throw new ConflictException('An API connection with this name already exists');
		}
	}
}
