import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { runBootstrap } from './run-bootstrap';

@Injectable()
export class BootstrapService implements OnModuleInit {
	private readonly logger = new Logger(BootstrapService.name);

	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService,
	) {}

	async onModuleInit(): Promise<void> {
		try {
			await runBootstrap(
				this.prisma,
				{
					adminUsername: this.configService.get<string>('ADMIN_USERNAME'),
					adminPassword: this.configService.get<string>('ADMIN_PASSWORD'),
					idpBaseUrl: this.configService.get<string>('IDP_BASE_URL') ?? '',
					nodeEnv: this.configService.get<string>('NODE_ENV'),
				},
				this.logger,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`Bootstrap failed: ${message}`);
			throw error;
		}
	}
}
