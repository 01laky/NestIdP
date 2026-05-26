import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BootstrapService implements OnModuleInit {
	private readonly logger = new Logger(BootstrapService.name);

	constructor(private readonly configService: ConfigService) {}

	onModuleInit(): void {
		const adminUsername = this.configService.get<string>('ADMIN_USERNAME');
		const adminPassword = this.configService.get<string>('ADMIN_PASSWORD');

		if (adminUsername && adminPassword) {
			this.logger.log(
				`Bootstrap placeholder: ADMIN_USERNAME is set; first admin seeding not implemented yet (TODO: next prompt).`,
			);
			return;
		}

		this.logger.warn(
			'Bootstrap placeholder: ADMIN_USERNAME / ADMIN_PASSWORD not set; admin seed deferred.',
		);
	}
}
