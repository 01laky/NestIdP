import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SamlModule } from '../saml/saml.module';
import { IdpSettingsAuditService } from './idp-settings-audit.service';
import { IdpSettingsController } from './idp-settings.controller';
import { IdpSettingsService } from './idp-settings.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, AdminAuthModule, EncryptionModule, SamlModule],
	controllers: [IdpSettingsController],
	providers: [IdpSettingsService, IdpSettingsAuditService],
	exports: [IdpSettingsService],
})
export class IdpSettingsModule {}
