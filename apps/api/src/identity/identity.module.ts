import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityRepository } from './identity.repository';
import { IdentityService } from './identity.service';

@Module({
	imports: [PrismaModule],
	providers: [IdentityRepository, IdentityService],
	exports: [IdentityService, IdentityRepository],
})
export class IdentityModule {}
