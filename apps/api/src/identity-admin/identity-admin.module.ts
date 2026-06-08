import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthProtectionModule } from '../auth-protection/auth-protection.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SamlSessionRegistryModule } from '../saml-sessions/saml-session-registry.module';
import { IdentityAdminAuditService } from './services/identity-admin-audit.service';
import { IdentityAdminController } from './controllers/identity-admin.controller';
import { IdentityAdminService } from './services/identity-admin.service';

@Module({
	imports: [
		PrismaModule,
		AdminAuthModule,
		AuthProtectionModule,
		EncryptionModule,
		IdentityModule,
		SamlSessionRegistryModule,
	],
	controllers: [IdentityAdminController],
	providers: [IdentityAdminService, IdentityAdminAuditService],
})
export class IdentityAdminModule {}
