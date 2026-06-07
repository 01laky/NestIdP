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

	const app = await NestFactory.create(AppModule);
	const configService = app.get(ConfigService);

	applyHttpSecurity(app, configService);

	app.use(cookieParser());
	app.use(express.urlencoded({ extended: false }));
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);
	const port = Number(configService.get<string>('PORT') ?? 3000);
	await app.listen(port);
	Logger.log(`NestIdP API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
	Logger.error(err instanceof Error ? err.message : String(err), undefined, 'Bootstrap');
	process.exit(1);
});
