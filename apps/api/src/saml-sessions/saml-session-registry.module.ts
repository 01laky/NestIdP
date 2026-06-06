import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SamlSsoSessionService } from './services/saml-sso-session.service';

/**
 * Low-level module providing the revocable SSO-session registry. Imported by
 * SamlModule, AuthModule, and IdentityModule — depends only on global Prisma + Audit,
 * so it introduces no cycles between those feature modules.
 */
@Module({
	imports: [PrismaModule],
	providers: [SamlSsoSessionService],
	exports: [SamlSsoSessionService],
})
export class SamlSessionRegistryModule {}
