import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpConnectionsService } from './sp-connections.service';

describe('SpConnectionsService', () => {
	const audit = {
		logCreated: jest.fn(),
		logUpdated: jest.fn(),
		logDeleted: jest.fn(),
	};

	const prisma = {
		spConnection: {
			findMany: jest.fn(),
			findUnique: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
		},
	};

	const idpSettingsService = {
		getMetadataUrlResponse: jest.fn(),
	};

	const configService = {
		get: jest.fn((key: string) => {
			if (key === 'NODE_ENV') {
				return 'test';
			}
			if (key === 'IDP_BASE_URL') {
				return 'http://localhost:3000';
			}
			return undefined;
		}),
	} as unknown as ConfigService;

	const service = new SpConnectionsService(
		prisma as never,
		configService,
		audit as never,
		idpSettingsService as never,
	);

	const sampleRow = {
		id: 'c1234567890123456789012345',
		name: 'App',
		spEntityId: 'urn:sp:app',
		acsUrl: 'https://sp.example.com/acs',
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		attributeMapping: null,
		active: true,
		spCertificate: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};

	beforeEach(() => {
		jest.clearAllMocks();
		prisma.spConnection.findMany.mockResolvedValue([]);
		prisma.spConnection.findUnique.mockResolvedValue(null);
	});

	it('API-SPC-SVC-01: create trims fields and calls audit', async () => {
		prisma.spConnection.create.mockResolvedValue(sampleRow);

		const result = await service.create({
			name: '  App  ',
			spEntityId: '  urn:sp:app  ',
			acsUrl: 'https://sp.example.com/acs/',
		});

		expect(prisma.spConnection.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					name: 'App',
					spEntityId: 'urn:sp:app',
					acsUrl: 'https://sp.example.com/acs',
				}),
			}),
		);
		expect(audit.logCreated).toHaveBeenCalledWith(sampleRow.id, sampleRow.spEntityId);
		expect(result.item.name).toBe('App');
	});

	it('API-SPC-SVC-02: create duplicate name → ConflictException', async () => {
		prisma.spConnection.findMany.mockResolvedValue([{ name: 'App' }]);

		await expect(
			service.create({
				name: 'app',
				spEntityId: 'urn:sp:other',
				acsUrl: 'https://sp.example.com/acs',
			}),
		).rejects.toThrow(ConflictException);
	});

	it('API-SPC-SVC-03: create duplicate spEntityId → ConflictException', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(sampleRow);

		await expect(
			service.create({
				name: 'Other',
				spEntityId: 'urn:sp:app',
				acsUrl: 'https://sp.example.com/acs',
			}),
		).rejects.toThrow('spEntityId already exists');
	});

	it('API-SPC-SVC-04: create invalid mapping → BadRequestException', async () => {
		await expect(
			service.create({
				name: 'X',
				spEntityId: 'urn:sp:x',
				acsUrl: 'https://sp.example.com/acs',
				attributeMapping: { attributes: [{ samlName: '', source: 'email' }] },
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SPC-SVC-05: update empty body → BadRequestException', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(sampleRow);

		await expect(service.update(sampleRow.id, {})).rejects.toThrow(
			'At least one field must be provided',
		);
	});

	it('API-SPC-SVC-06: update empty name → BadRequestException', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(sampleRow);

		await expect(service.update(sampleRow.id, { name: '   ' })).rejects.toThrow(
			'name must not be empty',
		);
	});

	it('API-SPC-SVC-07: update clears attributeMapping with null', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.spConnection.update.mockResolvedValue({ ...sampleRow, attributeMapping: null });

		await service.update(sampleRow.id, { attributeMapping: null });

		expect(prisma.spConnection.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ attributeMapping: expect.anything() }),
			}),
		);
	});

	it('API-SPC-SVC-08: delete calls audit after remove', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(sampleRow);
		prisma.spConnection.delete.mockResolvedValue(sampleRow);

		const result = await service.delete(sampleRow.id);

		expect(audit.logDeleted).toHaveBeenCalledWith(sampleRow.id, sampleRow.spEntityId);
		expect(result).toEqual({ ok: true, id: sampleRow.id });
	});

	it('API-SPC-SVC-09: getById unknown → NotFoundException', async () => {
		await expect(service.getById('c9999999999999999999999999')).rejects.toThrow(NotFoundException);
	});

	it('API-SPC-SVC-10: resolveNameIdFormat defaults when blank', async () => {
		prisma.spConnection.create.mockResolvedValue(sampleRow);

		await service.create({
			name: 'Default Format',
			spEntityId: 'urn:sp:fmt',
			acsUrl: 'https://sp.example.com/acs',
		});

		expect(prisma.spConnection.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				}),
			}),
		);
	});

	it('API-SPC-SVC-11: invalid nameIdFormat → BadRequestException', async () => {
		await expect(
			service.create({
				name: 'X',
				spEntityId: 'urn:sp:x',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: 'not-a-urn',
			}),
		).rejects.toThrow('Invalid nameIdFormat');
	});

	it('API-SPC-SVC-12: getMetadataUrl when settings missing → NotFoundException', async () => {
		idpSettingsService.getMetadataUrlResponse.mockRejectedValue(
			new NotFoundException('IdP settings not configured'),
		);

		await expect(service.getMetadataUrl()).rejects.toThrow('IdP settings not configured');
	});

	it('API-SPC-SVC-13: getMetadataUrl delegates to IdpSettingsService', async () => {
		idpSettingsService.getMetadataUrlResponse.mockResolvedValue({
			metadataUrl: 'http://localhost:3000/saml/metadata',
			entityId: 'http://localhost:3000',
			ssoUrl: 'http://localhost:3000/saml/sso',
		});

		const result = await service.getMetadataUrl();

		expect(idpSettingsService.getMetadataUrlResponse).toHaveBeenCalled();
		expect(result).toEqual({
			metadataUrl: 'http://localhost:3000/saml/metadata',
			entityId: 'http://localhost:3000',
			ssoUrl: 'http://localhost:3000/saml/sso',
		});
	});

	it('API-SPC-SVC-14: production rejects http acsUrl', async () => {
		(configService.get as jest.Mock).mockImplementation((key: string) =>
			key === 'NODE_ENV' ? 'production' : 'http://localhost:3000',
		);

		await expect(
			service.create({
				name: 'X',
				spEntityId: 'urn:sp:x',
				acsUrl: 'http://sp.example.com/acs',
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SPC-SVC-15: list returns items ordered by createdAt asc', async () => {
		const older = {
			...sampleRow,
			id: 'c1111111111111111111111111',
			createdAt: new Date('2020-01-01'),
		};
		const newer = {
			...sampleRow,
			id: 'c2222222222222222222222222',
			createdAt: new Date('2021-01-01'),
		};
		prisma.spConnection.findMany.mockResolvedValue([older, newer]);

		const result = await service.list();

		expect(result.items[0]?.id).toBe(older.id);
		expect(prisma.spConnection.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
		);
	});

	it('API-SPC-SVC-16: create stores valid spCertificate PEM', async () => {
		const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
		prisma.spConnection.create.mockResolvedValue({ ...sampleRow, spCertificate: pem });

		await service.create({
			name: 'Cert',
			spEntityId: 'urn:sp:cert',
			acsUrl: 'https://sp.example.com/acs',
			spCertificate: pem,
		});

		expect(prisma.spConnection.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ spCertificate: pem }),
			}),
		);
	});
});
