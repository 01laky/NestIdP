import { toSpConnectionPublicDto } from '@api/sp-connections/mappers/sp-connections.mapper';

describe('toSpConnectionPublicDto', () => {
	const baseRow = {
		id: 'c1234567890123456789012345',
		name: 'App',
		spEntityId: 'urn:sp:app',
		acsUrl: 'https://sp.example.com/acs',
		sloUrl: null,
		sloSoapUrl: null,
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		attributeMapping: { attributes: [{ samlName: 'uid', source: 'username' }] },
		active: true,
		spCertificate: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
		wantAssertionsEncrypted: false,
		wantAuthnRequestsSigned: false,
		wantLogoutRequestsSigned: false,
		lastBackchannelLogoutStatus: null,
		lastBackchannelLogoutAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
	};

	it('API-SPC-MAP-DTO-01: never exposes spCertificate PEM', () => {
		const dto = toSpConnectionPublicDto(baseRow);
		expect(dto).not.toHaveProperty('spCertificate');
		expect(dto.hasSpCertificate).toBe(true);
	});

	it('API-SPC-MAP-DTO-02: hasSpCertificate false when cert null', () => {
		const dto = toSpConnectionPublicDto({ ...baseRow, spCertificate: null });
		expect(dto.hasSpCertificate).toBe(false);
	});

	it('API-SPC-MAP-DTO-03: ISO timestamps', () => {
		const dto = toSpConnectionPublicDto(baseRow);
		expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
		expect(dto.updatedAt).toBe('2026-01-02T00:00:00.000Z');
	});

	it('API-SPC-MAP-DTO-04: attributeMapping null when DB null', () => {
		const dto = toSpConnectionPublicDto({ ...baseRow, attributeMapping: null });
		expect(dto.attributeMapping).toBeNull();
	});
});
