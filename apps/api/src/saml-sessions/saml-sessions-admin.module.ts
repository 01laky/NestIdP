import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SamlSessionRegistryModule } from './saml-session-registry.module';
import { SamlSessionsController } from './controllers/saml-sessions.controller';

@Module({
	imports: [AdminAuthModule, SamlSessionRegistryModule],
	controllers: [SamlSessionsController],
})
export class SamlSessionsAdminModule {}
