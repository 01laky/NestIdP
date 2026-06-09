import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { applyHttpSecurity } from './common/utils/http-security';
import { databaseEncryptionMode } from './prisma/libsql';
import { runMigrations } from './prisma/db-migrator';

async function prepareDatabase(): Promise<void> {
	// Resolving the key enforces the production "must be encrypted" guard and throws a clear error.
	const mode = databaseEncryptionMode();
	Logger.log(`Database mode: ${mode} (libSQL single file)`, 'Bootstrap');
	const result = await runMigrations();
	Logger.log(
		`Migrations: ${result.applied.length} applied, ${result.alreadyApplied} already present (${result.total} total)`,
		'Bootstrap',
	);
}

async function bootstrap() {
	await prepareDatabase();

	// MIGRATE_ONLY: run migrations and exit (Docker init / CI step), without starting the server.
	if (['1', 'true', 'yes'].includes((process.env.MIGRATE_ONLY ?? '').toLowerCase())) {
		Logger.log('MIGRATE_ONLY set — migrations applied, exiting.', 'Bootstrap');
		return;
	}

	// §5.B10: take over body parsing so we can set an explicit size limit. Nest's default JSON parser caps
	// at 100kb, which is smaller than the 256KB `parse-slo-from-metadata` DTO bound — large SP metadata was
	// rejected before validation could run. 1mb comfortably covers it (and large SAML POST bodies).
	const BODY_SIZE_LIMIT = '1mb';
	const app = await NestFactory.create(AppModule, { bodyParser: false });
	const configService = app.get(ConfigService);

	// §5.B10: ensure OnModuleDestroy / interval cleanups (Prisma $disconnect, audit-retention &
	// back-channel schedulers) actually run on SIGTERM/SIGINT (container stop).
	app.enableShutdownHooks();

	applyHttpSecurity(app, configService);

	app.use(cookieParser());
	app.use(express.json({ limit: BODY_SIZE_LIMIT }));
	app.use(express.urlencoded({ extended: false, limit: BODY_SIZE_LIMIT }));
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);

	// §5.B10: validate PORT is a usable TCP port (env.validation already rejects non-numeric strings).
	const rawPort = configService.get<string>('PORT') ?? '3000';
	const port = Number(rawPort);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT "${rawPort}" — must be an integer in [1, 65535]`);
	}
	await app.listen(port);
	Logger.log(`NestIdP API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
	Logger.error(err instanceof Error ? err.message : String(err), undefined, 'Bootstrap');
	process.exit(1);
});
