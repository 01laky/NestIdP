import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

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
		const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
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
		const raw = this.configService.get<string>('AUDIT_RETENTION_DAYS');
		const parsed = Number.parseInt(String(raw ?? '90'), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
	}

	private getIntervalMs(): number {
		const raw = this.configService.get<string>('AUDIT_CLEANUP_INTERVAL_MS');
		const parsed = Number.parseInt(String(raw ?? '86400000'), 10);
		return Number.isFinite(parsed) ? parsed : 86400000;
	}
}
