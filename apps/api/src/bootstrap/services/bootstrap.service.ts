import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { PrismaService } from '../../prisma/services/prisma.service';
import { runBootstrap } from '../run-bootstrap';

@Injectable()
export class BootstrapService implements OnModuleInit {
	private readonly logger = new Logger(BootstrapService.name);

	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
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
					encryptCredential: (plain) => this.encryption.encrypt(plain),
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
