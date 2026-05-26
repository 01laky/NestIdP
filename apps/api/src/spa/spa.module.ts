import { Module } from '@nestjs/common';
import { SpaFallbackController } from './spa-fallback.controller';

@Module({
	controllers: [SpaFallbackController],
})
export class SpaModule {}
