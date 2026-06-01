import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SpConnectionsController } from './sp-connections.controller';
import { SpConnectionsService } from './sp-connections.service';

@Module({
	imports: [PrismaModule, AdminAuthModule],
	controllers: [SpConnectionsController],
	providers: [SpConnectionsService],
})
export class SpConnectionsModule {}
