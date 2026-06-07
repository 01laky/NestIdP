import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../../../admin-auth/admin-auth.module';
import { AuditCoreModule } from '../../../audit/audit-core.module';
import { EncryptionModule } from '../../../encryption/encryption.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { IdentityModule } from '../../identity.module';
import { EXTERNAL_KYSELY_FACTORY, RealExternalKyselyFactory } from './external-connection';
import { ExternalIdentityDatabaseController } from './external-identity-database.controller';
import { ExternalIdentityDatabaseService } from './external-identity-database.service';

@Module({
	imports: [PrismaModule, AdminAuthModule, EncryptionModule, IdentityModule, AuditCoreModule],
	controllers: [ExternalIdentityDatabaseController],
	providers: [
		ExternalIdentityDatabaseService,
		{ provide: EXTERNAL_KYSELY_FACTORY, useClass: RealExternalKyselyFactory },
	],
	exports: [ExternalIdentityDatabaseService],
})
export class ExternalIdentityDatabaseModule {}
