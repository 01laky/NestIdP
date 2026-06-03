import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

export function applyTrustProxy(app: INestApplication, configService: ConfigService): void {
	const trustProxy = configService.get<string>('TRUST_PROXY');
	if (trustProxy === 'true' || trustProxy === '1') {
		app.getHttpAdapter().getInstance().set('trust proxy', 1);
	}
}

export function applyProductionHelmet(app: INestApplication, configService: ConfigService): void {
	if (configService.get<string>('NODE_ENV') !== 'production') {
		return;
	}

	app.use(
		helmet({
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					scriptSrc: ["'self'"],
					styleSrc: ["'self'", "'unsafe-inline'"],
					imgSrc: ["'self'", 'data:'],
					connectSrc: ["'self'"],
					frameAncestors: ["'none'"],
				},
			},
			crossOriginEmbedderPolicy: false,
		}),
	);
}

export function applyHttpSecurity(app: INestApplication, configService: ConfigService): void {
	applyTrustProxy(app, configService);
	applyProductionHelmet(app, configService);
}
