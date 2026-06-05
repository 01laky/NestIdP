import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SpConnectionTestAcsResponseDto } from '@nestidp/shared';
import { assertValidAcsUrl } from '../../common/utils/acs-url.util';
import { PrismaService } from '../../prisma/services/prisma.service';
import { SpConnectionsAuditService } from './sp-connections-audit.service';

@Injectable()
export class SpConnectionTestAcsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly audit: SpConnectionsAuditService,
	) {}

	async testAcs(id: string): Promise<SpConnectionTestAcsResponseDto> {
		const row = await this.prisma.spConnection.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('Service Provider connection not found');
		}

		const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
		let acsUrl: string;
		try {
			acsUrl = assertValidAcsUrl(row.acsUrl, nodeEnv);
		} catch {
			return {
				ok: false,
				reachable: false,
				message: 'Stored ACS URL is invalid',
			};
		}

		try {
			const response = await fetch(acsUrl, {
				method: 'GET',
				signal: AbortSignal.timeout(10_000),
				redirect: 'follow',
			});

			const reachable = true;
			const ok = (response.status >= 200 && response.status < 300) || response.status === 405;
			const result: SpConnectionTestAcsResponseDto = {
				ok,
				reachable,
				statusCode: response.status,
				message: ok ? 'ACS endpoint responded' : `ACS returned HTTP ${response.status}`,
			};
			this.audit.logAcsTested(id, reachable, response.status);
			return result;
		} catch (error) {
			if (error instanceof Error && error.name === 'TimeoutError') {
				this.audit.logAcsTested(id, false);
				return {
					ok: false,
					reachable: false,
					message: 'ACS request timed out',
				};
			}
			this.audit.logAcsTested(id, false);
			return {
				ok: false,
				reachable: false,
				message: 'Could not reach ACS URL',
			};
		}
	}
}
