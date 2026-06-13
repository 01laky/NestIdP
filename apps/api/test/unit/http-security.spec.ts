import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { SamlPostBindingService } from '@api/saml/services/saml-post-binding.service';
import {
	applyHttpSecurity,
	applyProductionHelmet,
	applyTrustProxy,
} from '@api/common/utils/http-security';

@Controller('probe')
class ProbeController {
	@Get('ip')
	clientIp(@Req() req: Request) {
		return { ip: req.ip };
	}
}

@Module({
	controllers: [ProbeController],
})
class ProbeModule {}

describe('http-security', () => {
	let app: INestApplication;

	async function createApp(env: Record<string, string>) {
		const moduleRef = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [() => env],
				}),
				ProbeModule,
			],
		}).compile();

		app = moduleRef.createNestApplication();
		const configService = app.get(ConfigService);
		applyHttpSecurity(app, configService);
		await app.init();
		return app;
	}

	afterEach(async () => {
		if (app) {
			await app.close();
		}
	});

	it('API-TRUST-01: TRUST_PROXY=false leaves Express trust proxy disabled', async () => {
		await createApp({ NODE_ENV: 'test', TRUST_PROXY: 'false' });
		const expressApp = app.getHttpAdapter().getInstance();
		expect(expressApp.get('trust proxy')).toBeFalsy();
	});

	it('API-TRUST-02: TRUST_PROXY=true enables trust proxy hop count 1', async () => {
		await createApp({ NODE_ENV: 'test', TRUST_PROXY: 'true' });
		const expressApp = app.getHttpAdapter().getInstance();
		expect(expressApp.get('trust proxy')).toBe(1);
	});

	it('API-TRUST-03: TRUST_PROXY=1 enables trust proxy', async () => {
		await createApp({ NODE_ENV: 'test', TRUST_PROXY: '1' });
		expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
	});

	it('API-TRUST-03b: TRUST_PROXY=yes / on / mixed-case enable trust proxy (shared bool parser)', async () => {
		// Regression guard: previously only the literal 'true'/'1' enabled it, so 'yes'/'on'/'True'
		// silently left req.ip as the proxy IP. The shared parseBoolEnv now backs this toggle.
		for (const value of ['yes', 'on', 'True', 'TRUE']) {
			await createApp({ NODE_ENV: 'test', TRUST_PROXY: value });
			expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
			await app.close();
		}
	});

	it('API-TRUST-03c: a non-truthy TRUST_PROXY (e.g. "no", empty) leaves it disabled', async () => {
		for (const value of ['no', 'off', '0', '']) {
			await createApp({ NODE_ENV: 'test', TRUST_PROXY: value });
			expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBeFalsy();
			await app.close();
		}
	});

	it('API-TRUST-04: X-Forwarded-For used as req.ip when trust proxy enabled', async () => {
		await createApp({ NODE_ENV: 'test', TRUST_PROXY: 'true' });
		const response = await request(app.getHttpServer() as App)
			.get('/probe/ip')
			.set('X-Forwarded-For', '203.0.113.50')
			.expect(200);
		expect(response.body.ip).toBe('203.0.113.50');
	});

	it('API-HELM-01: Helmet not applied outside production', async () => {
		await createApp({ NODE_ENV: 'test', TRUST_PROXY: 'false' });
		const response = await request(app.getHttpServer() as App)
			.get('/probe/ip')
			.expect(200);
		expect(response.headers['content-security-policy']).toBeUndefined();
	});

	it('API-HELM-02: Helmet applies CSP in production', async () => {
		await createApp({ NODE_ENV: 'production', TRUST_PROXY: 'false' });
		const response = await request(app.getHttpServer() as App)
			.get('/probe/ip')
			.expect(200);
		expect(response.headers['content-security-policy']).toContain("default-src 'self'");
	});

	it('API-HELM-03: production CSP allows unsafe-inline styles for SAML HTML', async () => {
		await createApp({ NODE_ENV: 'production', TRUST_PROXY: 'false' });
		const response = await request(app.getHttpServer() as App)
			.get('/probe/ip')
			.expect(200);
		expect(String(response.headers['content-security-policy'])).toContain("'unsafe-inline'");
	});

	it('API-HELM-04: SAML auto-post HTML uses body onload not inline script (Helmet-safe)', () => {
		const html = new SamlPostBindingService().renderAutoPostForm(
			'https://sp.example.com/acs',
			'c2FtbFJlc3BvbnNl',
			'relay',
		);
		expect(html).toContain('onload="document.forms[0].submit()"');
		expect(html).not.toContain('<script');
		expect(html).toContain('method="post"');
	});

	it('API-HELM-05: applyProductionHelmet is no-op in development', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [() => ({ NODE_ENV: 'development' })],
				}),
				ProbeModule,
			],
		}).compile();
		app = moduleRef.createNestApplication();
		applyProductionHelmet(app, app.get(ConfigService));
		await app.init();
		const response = await request(app.getHttpServer() as App)
			.get('/probe/ip')
			.expect(200);
		expect(response.headers['content-security-policy']).toBeUndefined();
	});

	it('API-HELM-06: applyTrustProxy alone does not set Helmet headers', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					ignoreEnvFile: true,
					load: [() => ({ NODE_ENV: 'production', TRUST_PROXY: 'true' })],
				}),
				ProbeModule,
			],
		}).compile();
		app = moduleRef.createNestApplication();
		applyTrustProxy(app, app.get(ConfigService));
		await app.init();
		const response = await request(app.getHttpServer() as App)
			.get('/probe/ip')
			.expect(200);
		expect(response.headers['content-security-policy']).toBeUndefined();
		expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
	});
});
