import { Module } from '@nestjs/common';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BootstrapService } from './bootstrap.service';

@Module({
	imports: [PrismaModule, EncryptionModule],
	providers: [BootstrapService],
})
export class BootstrapModule {}
