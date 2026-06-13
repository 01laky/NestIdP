import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

import { parseBoolEnv } from '../config/parse-bool-env.util';

export function applyTrustProxy(app: INestApplication, configService: ConfigService): void {
	const trustProxy = configService.get<string>('TRUST_PROXY');
	// Use the shared boolean parser (accepts 1/true/yes/on, case-insensitive) so this
	// security-relevant toggle matches every other env flag — `TRUST_PROXY=yes`/`True` must work.
	// Getting this wrong leaves req.ip as the proxy IP, corrupting rate-limit keys and audit IPs.
	if (parseBoolEnv(trustProxy)) {
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
