import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ApiConnectionTestResponseDto } from '@nestidp/shared';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../encryption/credentials-encryption.port';
import { redactBearerToken } from '../encryption/redact-secret.util';
import { PrismaService } from '../prisma/prisma.service';
import { ApiConnectionsAuditService } from './api-connections-audit.service';
import { normalizeBaseUrl } from './base-url.util';

@Injectable()
export class ApiConnectionTestService {
	private readonly logger = new Logger(ApiConnectionTestService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: ApiConnectionsAuditService,
	) {}

	async testConnection(id: string): Promise<ApiConnectionTestResponseDto> {
		const row = await this.prisma.apiConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('API connection not found');
		}

		let token: string;
		try {
			token = this.encryption.decrypt(row.authCredentialsEncrypted);
		} catch (error) {
			this.logger.warn(
				`Failed to decrypt credentials for connection ${id}: ${redactBearerToken(String(error))}`,
			);
			return {
				ok: false,
				reachable: false,
				message: 'Stored credentials could not be decrypted',
			};
		}

		const url = new URL('/users?limit=1', normalizeBaseUrl(row.baseUrl)).toString();

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(10_000),
			});

			const ok = response.status >= 200 && response.status < 300;
			const result = {
				ok,
				reachable: true,
				statusCode: response.status,
				message: ok
					? 'Identity API responded successfully'
					: `Identity API returned HTTP ${response.status}`,
			};
			this.audit.logTested(id, true, response.status);
			return result;
		} catch (error) {
			this.logger.warn(
				`Connectivity test failed for connection ${id}: ${error instanceof Error ? error.message : 'unknown error'}`,
			);
			if (error instanceof Error && error.name === 'TimeoutError') {
				const result = {
					ok: false,
					reachable: false,
					message: 'Identity API request timed out',
				};
				this.audit.logTested(id, false);
				return result;
			}
			const result = {
				ok: false,
				reachable: false,
				message: 'Could not reach identity API',
			};
			this.audit.logTested(id, false);
			return result;
		}
	}
}
