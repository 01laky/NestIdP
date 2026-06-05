import { Module } from '@nestjs/common';
import { SpaFallbackController } from './controllers/spa-fallback.controller';

@Module({
	controllers: [SpaFallbackController],
})
export class SpaModule {}
