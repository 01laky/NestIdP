import {
	assertValidSpAttributeMapping,
	SpAttributeMappingValidationError,
} from './sp-attribute-mapping.validator';

describe('assertValidSpAttributeMapping', () => {
	it('API-SPC-MAP-01: null and undefined return null', () => {
		expect(assertValidSpAttributeMapping(null)).toBeNull();
		expect(assertValidSpAttributeMapping(undefined)).toBeNull();
	});

	it('API-SPC-MAP-02: accepts valid nameId and attributes', () => {
		const mapping = {
			nameId: { source: 'email' as const, format: 'custom' },
			attributes: [{ samlName: 'uid', source: 'username' as const }],
		};
		expect(assertValidSpAttributeMapping(mapping)).toEqual(mapping);
	});

	it('API-SPC-MAP-03: rejects array root', () => {
		expect(() => assertValidSpAttributeMapping([] as never)).toThrow(
			SpAttributeMappingValidationError,
		);
	});

	it('API-SPC-MAP-04: rejects invalid nameId source', () => {
		expect(() =>
			assertValidSpAttributeMapping({ nameId: { source: 'password' as never } }),
		).toThrow('Invalid nameId source');
	});

	it('API-SPC-MAP-05: rejects non-object nameId', () => {
		expect(() => assertValidSpAttributeMapping({ nameId: 'email' as never })).toThrow(
			'nameId must be an object',
		);
	});

	it('API-SPC-MAP-06: rejects non-array attributes', () => {
		expect(() => assertValidSpAttributeMapping({ attributes: {} as never })).toThrow(
			'attributes must be an array',
		);
	});

	it('API-SPC-MAP-07: rejects empty samlName', () => {
		expect(() =>
			assertValidSpAttributeMapping({
				attributes: [{ samlName: '  ', source: 'email' }],
			}),
		).toThrow('samlName is required');
	});

	it('API-SPC-MAP-08: rejects unknown attribute source', () => {
		expect(() =>
			assertValidSpAttributeMapping({
				attributes: [{ samlName: 'x', source: 'unknown' as never }],
			}),
		).toThrow('Invalid attribute source: unknown');
	});

	it('API-SPC-MAP-09: rejects non-string nameId format', () => {
		expect(() =>
			assertValidSpAttributeMapping({ nameId: { source: 'email', format: 1 as never } }),
		).toThrow('nameId format must be a string');
	});
});
