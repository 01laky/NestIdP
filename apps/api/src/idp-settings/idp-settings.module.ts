import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SamlModule } from '../saml/saml.module';
import { IdpSettingsAuditService } from './services/idp-settings-audit.service';
import { IdpSettingsController } from './controllers/idp-settings.controller';
import { IdpSettingsService } from './services/idp-settings.service';
import { CertRotationConfig } from './cert-rotation.config';
import { CertRotationSchedulerService } from './services/cert-rotation-scheduler.service';
import { CERT_ROTATION_NOTIFIER, NoopCertRotationNotifier } from './cert-rotation-notifier';

@Module({
	imports: [PrismaModule, AuditCoreModule, AdminAuthModule, EncryptionModule, SamlModule],
	controllers: [IdpSettingsController],
	providers: [
		IdpSettingsService,
		IdpSettingsAuditService,
		CertRotationConfig,
		CertRotationSchedulerService,
		{ provide: CERT_ROTATION_NOTIFIER, useClass: NoopCertRotationNotifier },
	],
	exports: [IdpSettingsService],
})
export class IdpSettingsModule {}
