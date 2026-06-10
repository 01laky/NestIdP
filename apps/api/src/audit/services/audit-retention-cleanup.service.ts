import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MS_PER_DAY } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import { positiveIntOrDefault } from '../../common/config/positive-int.util';

@Injectable()
export class AuditRetentionCleanupService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(AuditRetentionCleanupService.name);
	private intervalHandle: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	onModuleInit(): void {
		const intervalMs = this.getIntervalMs();
		void this.purgeExpired();
		if (intervalMs > 0) {
			this.intervalHandle = setInterval(() => {
				void this.purgeExpired();
			}, intervalMs);
		}
	}

	onModuleDestroy(): void {
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	async purgeExpired(): Promise<number> {
		const retentionDays = this.getRetentionDays();
		const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);
		const result = await this.prisma.auditEvent.deleteMany({
			where: { createdAt: { lt: cutoff } },
		});
		if (result.count > 0) {
			this.logger.log(
				JSON.stringify({
					event: 'audit_retention_purged',
					deletedCount: result.count,
					retentionDays,
				}),
			);
		}
		return result.count;
	}

	private getRetentionDays(): number {
		return positiveIntOrDefault(this.configService.get<string>('AUDIT_RETENTION_DAYS'), 90);
	}

	private getIntervalMs(): number {
		const raw = this.configService.get<string>('AUDIT_CLEANUP_INTERVAL_MS');
		const parsed = Number.parseInt(String(raw ?? MS_PER_DAY), 10);
		return Number.isFinite(parsed) ? parsed : MS_PER_DAY;
	}
}
