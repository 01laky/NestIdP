import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiConnectionTestService } from './api-connection-test.service';
import { ApiConnectionsController } from './api-connections.controller';
import { ApiConnectionsService } from './api-connections.service';

@Module({
	imports: [PrismaModule, AdminAuthModule, EncryptionModule],
	controllers: [ApiConnectionsController],
	providers: [ApiConnectionsService, ApiConnectionTestService],
})
export class ApiConnectionsModule {}
