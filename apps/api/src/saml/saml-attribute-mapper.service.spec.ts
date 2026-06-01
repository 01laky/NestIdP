import { SamlAttributeMapperService } from './saml-attribute-mapper.service';

describe('SamlAttributeMapperService', () => {
	const mapper = new SamlAttributeMapperService();

	const baseUser = {
		id: 'u1',
		username: 'alice',
		email: 'alice@example.com',
		displayName: 'Alice',
		groups: ['Engineering'],
		roles: ['User'],
	};

	it('API-SAML-MAP-01: default mapping includes email and memberOf', () => {
		const mapped = mapper.mapUser(
			baseUser,
			'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			null,
		);
		expect(mapped.nameId).toBe('alice@example.com');
		expect(mapped.attributes.find((a) => a.name === 'email')?.values).toEqual([
			'alice@example.com',
		]);
		expect(mapped.attributes.find((a) => a.name === 'memberOf')?.values).toEqual(['Engineering']);
	});

	it('API-SAML-MAP-02: NameID falls back to username when email null', () => {
		const mapped = mapper.mapUser(
			{ ...baseUser, email: null },
			'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			null,
		);
		expect(mapped.nameId).toBe('alice');
	});

	it('API-SAML-MAP-03: custom mapping overrides default attributes', () => {
		const mapped = mapper.mapUser(
			baseUser,
			'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
			{
				attributes: [{ samlName: 'uid', source: 'username' }],
			},
		);
		expect(mapped.attributes).toEqual([{ name: 'uid', values: ['alice'] }]);
	});

	it('API-SAML-MAP-04: nameId source username from mapping', () => {
		const mapped = mapper.mapUser(
			baseUser,
			'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			{
				nameId: { source: 'username' },
			},
		);
		expect(mapped.nameId).toBe('alice');
	});

	it('API-SAML-MAP-05: skips empty attribute sources', () => {
		const mapped = mapper.mapUser(
			{ ...baseUser, email: null, displayName: null, groups: [], roles: [] },
			'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
			{ attributes: [{ samlName: 'email', source: 'email' }] },
		);
		expect(mapped.attributes).toEqual([]);
	});

	it('API-SAML-MAP-06: default mapping includes role attribute', () => {
		const mapped = mapper.mapUser(
			baseUser,
			'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
			null,
		);
		expect(mapped.attributes.find((a) => a.name === 'role')?.values).toEqual(['User']);
	});

	it('API-SAML-MAP-07: nameId uses email when mapping specifies email source', () => {
		const mapped = mapper.mapUser(
			baseUser,
			'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
			{
				nameId: { source: 'email' },
			},
		);
		expect(mapped.nameId).toBe('alice@example.com');
	});

	it('API-SAML-MAP-08: custom mapping nameId format override', () => {
		const format = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';
		const mapped = mapper.mapUser(
			baseUser,
			'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			{
				nameId: { source: 'username', format },
			},
		);
		expect(mapped.nameIdFormat).toBe(format);
	});
});
