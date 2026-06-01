import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AdminModule } from './admin/admin.module';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AuthModule } from './auth/auth.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import {
	getWebDistPath,
	resolveWebDistExists,
	shouldEnableStaticServing,
	STATIC_ROUTE_EXCLUDES,
} from './config/static-assets.config';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { PrismaModule } from './prisma/prisma.module';
import { SamlModule } from './saml/saml.module';
import { SpaModule } from './spa/spa.module';
import { SyncModule } from './sync/sync.module';
import { EncryptionModule } from './encryption/encryption.module';

const webDistPath = getWebDistPath(__dirname);
const enableStaticServing = shouldEnableStaticServing(
	process.env.NODE_ENV,
	resolveWebDistExists(__dirname),
);

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate: validateEnv,
			envFilePath: [join(process.cwd(), '../../.env'), join(process.cwd(), '.env'), '.env'],
		}),
		...(enableStaticServing
			? [
					ServeStaticModule.forRoot({
						rootPath: webDistPath,
						exclude: [...STATIC_ROUTE_EXCLUDES],
						serveStaticOptions: {
							index: false,
						},
					}),
				]
			: []),
		PrismaModule,
		BootstrapModule,
		HealthModule,
		EncryptionModule,
		AdminAuthModule,
		AdminModule,
		AuthModule,
		SyncModule,
		IdentityModule,
		SamlModule,
		SpaModule,
	],
})
export class AppModule {}
