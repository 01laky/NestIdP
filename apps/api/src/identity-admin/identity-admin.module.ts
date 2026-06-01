import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityAdminController } from './identity-admin.controller';
import { IdentityAdminService } from './identity-admin.service';

@Module({
	imports: [PrismaModule, AdminAuthModule],
	controllers: [IdentityAdminController],
	providers: [IdentityAdminService],
})
export class IdentityAdminModule {}
