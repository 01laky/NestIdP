import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SamlController } from '@api/saml/controllers/saml.controller';
import { SamlSsoService } from '@api/saml/services/saml-sso.service';
import { SamlLogoutService } from '@api/saml/services/saml-logout.service';
import { SamlSloRateLimiterService } from '@api/saml/services/saml-slo-rate-limiter.service';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';

describe('SamlController', () => {
	let controller: SamlController;
	const samlSsoService = {
		getMetadataXml: jest.fn().mockResolvedValue('<EntityDescriptor/>'),
		handleRedirectSso: jest.fn().mockResolvedValue({ redirectUrl: '/login?samlSessionId=test' }),
	};
	const samlLogoutService = {
		handleRedirectSlo: jest
			.fn()
			.mockResolvedValue({ delivery: { type: 'logged-out' }, clearEndUserCookie: true }),
		handlePostSlo: jest
			.fn()
			.mockResolvedValue({ delivery: { type: 'logged-out' }, clearEndUserCookie: true }),
	};
	const sloRateLimiter = { hitAndCheck: jest.fn().mockReturnValue(false) };
	const loginProtection = {
		precheckSso: jest.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 }),
		enforceBlock: jest.fn(),
	};
	const configService = { get: jest.fn().mockReturnValue('test') };

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [SamlController],
			providers: [
				{ provide: SamlSsoService, useValue: samlSsoService },
				{ provide: SamlLogoutService, useValue: samlLogoutService },
				{ provide: SamlSloRateLimiterService, useValue: sloRateLimiter },
				{ provide: LoginProtectionService, useValue: loginProtection },
				{ provide: ConfigService, useValue: configService },
			],
		}).compile();
		controller = module.get(SamlController);
		jest.clearAllMocks();
	});

	it('delegates metadata to SamlSsoService', async () => {
		const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
		await controller.getMetadata(res as never);
		expect(samlSsoService.getMetadataXml).toHaveBeenCalled();
		expect(res.send).toHaveBeenCalledWith('<EntityDescriptor/>');
	});

	it('API-SLO-CT-01: POST /saml/slo without form Content-Type → 415', async () => {
		const req = { headers: { 'content-type': 'application/json' }, ip: 'ip' };
		const res = { redirect: jest.fn() };
		await expect(
			controller.postSlo('x', undefined, req as never, res as never),
		).rejects.toMatchObject({ status: 415 });
	});

	it('API-SLO-RATE-CTRL: rate-limited SLO request → 429', async () => {
		sloRateLimiter.hitAndCheck.mockReturnValueOnce(true);
		const req = { ip: 'ip', url: '/saml/slo?SAMLRequest=x' };
		const res = { redirect: jest.fn() };
		await expect(
			controller.getSlo('x', undefined, req as never, res as never),
		).rejects.toMatchObject({ status: 429 });
	});

	it('redirect SLO delegates and clears cookie on logged-out delivery', async () => {
		const req = { ip: 'ip', url: '/saml/slo?SAMLRequest=x' };
		const res = { redirect: jest.fn(), clearCookie: jest.fn() };
		await controller.getSlo('x', undefined, req as never, res as never);
		expect(samlLogoutService.handleRedirectSlo).toHaveBeenCalled();
		expect(res.clearCookie).toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledWith(302, '/logged-out');
	});
});
