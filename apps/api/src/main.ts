import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	app.use(cookieParser());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);
	const configService = app.get(ConfigService);
	const port = Number(configService.get<string>('PORT') ?? 3000);
	await app.listen(port);
	Logger.log(`NestIdP API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
