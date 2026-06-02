import { SAML_NAME_ID_FORMATS } from '@nestidp/shared';
import {
	assertValidIdpEntityId,
	assertValidIdpNameIdFormat,
	IdpEntityIdValidationError,
	IdpNameIdFormatValidationError,
} from './idp-entity-id.validator';

describe('idp-entity-id.validator', () => {
	it('API-IDP-ENT-01: accepts https entityId', () => {
		expect(assertValidIdpEntityId('https://idp.example.com')).toBe('https://idp.example.com');
	});

	it('API-IDP-ENT-02: accepts http entityId', () => {
		expect(assertValidIdpEntityId('http://localhost:3000')).toBe('http://localhost:3000');
	});

	it('API-IDP-ENT-03: accepts urn entityId', () => {
		expect(assertValidIdpEntityId('urn:nestidp:test')).toBe('urn:nestidp:test');
	});

	it('API-IDP-ENT-04: trims entityId', () => {
		expect(assertValidIdpEntityId('  https://idp.example.com  ')).toBe('https://idp.example.com');
	});

	it('API-IDP-ENT-05: rejects empty entityId', () => {
		expect(() => assertValidIdpEntityId('   ')).toThrow(IdpEntityIdValidationError);
	});

	it('API-IDP-ENT-06: rejects invalid scheme', () => {
		expect(() => assertValidIdpEntityId('ftp://idp.example.com')).toThrow('http(s) URL or urn');
	});

	it('API-IDP-ENT-07: rejects entityId over 512 chars', () => {
		expect(() => assertValidIdpEntityId(`https://idp.example.com/${'x'.repeat(512)}`)).toThrow(
			'too long',
		);
	});

	it('API-IDP-ENT-08: accepts known SAML nameIdFormat', () => {
		const format = SAML_NAME_ID_FORMATS[0];
		expect(assertValidIdpNameIdFormat(format)).toBe(format);
	});

	it('API-IDP-ENT-09: accepts custom urn nameIdFormat', () => {
		const custom = 'urn:custom:nameid-format:employee';
		expect(assertValidIdpNameIdFormat(custom)).toBe(custom);
	});

	it('API-IDP-ENT-10: rejects invalid nameIdFormat', () => {
		expect(() => assertValidIdpNameIdFormat('not-a-urn')).toThrow(IdpNameIdFormatValidationError);
	});

	it('API-IDP-ENT-11: rejects empty nameIdFormat', () => {
		expect(() => assertValidIdpNameIdFormat('  ')).toThrow('required');
	});
});
