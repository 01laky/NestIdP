import { Test, TestingModule } from '@nestjs/testing';
import { SamlController } from '@api/saml/controllers/saml.controller';
import { SamlSsoService } from '@api/saml/services/saml-sso.service';

describe('SamlController', () => {
	let controller: SamlController;
	const samlSsoService = {
		getMetadataXml: jest.fn().mockResolvedValue('<EntityDescriptor/>'),
		handleRedirectSso: jest.fn().mockResolvedValue({ redirectUrl: '/login?samlSessionId=test' }),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [SamlController],
			providers: [{ provide: SamlSsoService, useValue: samlSsoService }],
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
});
