import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BootstrapService } from './bootstrap.service';

@Module({
	imports: [PrismaModule],
	providers: [BootstrapService],
})
export class BootstrapModule {}
