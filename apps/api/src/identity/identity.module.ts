import { Module } from '@nestjs/common';
import { AuthProtectionModule } from '../auth-protection/auth-protection.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityRepository } from './identity.repository';
import { IdentityService } from './services/identity.service';
import { ActiveIdentityStore } from './store/active-identity-store';

@Module({
	imports: [PrismaModule, AuthProtectionModule],
	providers: [IdentityRepository, ActiveIdentityStore, IdentityService],
	exports: [IdentityService, IdentityRepository, ActiveIdentityStore],
})
export class IdentityModule {}
