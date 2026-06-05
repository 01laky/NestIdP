import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/services/prisma.service';

@Injectable()
export class SamlSessionCleanupService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(SamlSessionCleanupService.name);
	private intervalHandle: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	async onModuleInit(): Promise<void> {
		const deleted = await this.purgeExpiredSessions();
		if (deleted > 0) {
			this.logger.log(`Purged ${deleted} expired SAML session(s) on startup`);
		}

		const intervalMs = this.getCleanupIntervalMs();
		if (intervalMs > 0) {
			this.intervalHandle = setInterval(() => {
				void this.purgeExpiredSessions().then((count) => {
					if (count > 0) {
						this.logger.log(`Purged ${count} expired SAML session(s)`);
					}
				});
			}, intervalMs);
		}
	}

	onModuleDestroy(): void {
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	async purgeExpiredSessions(): Promise<number> {
		const result = await this.prisma.samlSession.deleteMany({
			where: { expiresAt: { lt: new Date() } },
		});
		return result.count;
	}

	private getCleanupIntervalMs(): number {
		const raw = this.configService.get<number | string>('SAML_SESSION_CLEANUP_INTERVAL_MS');
		if (raw == null || raw === '') {
			return 0;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}
}
