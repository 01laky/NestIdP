import { NotImplementedException } from '@nestjs/common';
import { SamlMetadataService } from './saml-metadata.service';
import { SamlPostBindingService } from './saml-post-binding.service';
import { SamlRequestParserService } from './saml-request-parser.service';
import { SamlResponseBuilderService } from './saml-response-builder.service';

describe('SAML stub services', () => {
	describe('SamlRequestParserService', () => {
		it('throws NotImplementedException for redirect request parsing', () => {
			const service = new SamlRequestParserService();
			expect(() => service.parseRedirectRequest('abc')).toThrow(NotImplementedException);
		});

		it('includes descriptive message in NotImplementedException', () => {
			const service = new SamlRequestParserService();
			expect(() => service.parseRedirectRequest('')).toThrow(/not implemented/i);
		});

		it('throws for empty encoded request string', () => {
			const service = new SamlRequestParserService();
			expect(() => service.parseRedirectRequest('')).toThrow(NotImplementedException);
		});

		it('throws for long base64-like encoded request', () => {
			const service = new SamlRequestParserService();
			const encoded = 'a'.repeat(512);
			expect(() => service.parseRedirectRequest(encoded)).toThrow(NotImplementedException);
		});
	});

	describe('SamlMetadataService', () => {
		it('throws NotImplementedException when generating metadata', () => {
			const service = new SamlMetadataService();
			expect(() => service.generateMetadata()).toThrow(NotImplementedException);
		});

		it('includes descriptive message in NotImplementedException', () => {
			const service = new SamlMetadataService();
			expect(() => service.generateMetadata()).toThrow(/metadata generation/i);
		});
	});

	describe('SamlPostBindingService', () => {
		it('throws NotImplementedException when rendering auto-post form', () => {
			const service = new SamlPostBindingService();
			expect(() => service.renderAutoPostForm()).toThrow(NotImplementedException);
		});

		it('includes POST binding in error message', () => {
			const service = new SamlPostBindingService();
			expect(() => service.renderAutoPostForm()).toThrow(/POST binding/i);
		});
	});

	describe('SamlResponseBuilderService', () => {
		it('throws NotImplementedException when building login response', () => {
			const service = new SamlResponseBuilderService();
			expect(() => service.buildLoginResponse()).toThrow(NotImplementedException);
		});

		it('includes response building in error message', () => {
			const service = new SamlResponseBuilderService();
			expect(() => service.buildLoginResponse()).toThrow(/response building/i);
		});
	});
});
