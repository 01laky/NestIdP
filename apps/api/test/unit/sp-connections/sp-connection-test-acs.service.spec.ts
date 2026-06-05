import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpConnectionTestAcsService } from '@api/sp-connections/services/sp-connection-test-acs.service';

describe('SpConnectionTestAcsService', () => {
	const audit = { logAcsTested: jest.fn() };
	const prisma = {
		spConnection: { findUnique: jest.fn() },
	};
	const configService = {
		get: jest.fn(() => 'test'),
	} as unknown as ConfigService;

	const service = new SpConnectionTestAcsService(prisma as never, configService, audit as never);

	const row = {
		id: 'c1234567890123456789012345',
		acsUrl: 'https://sp.example.com/acs',
	};

	beforeEach(() => {
		jest.clearAllMocks();
		global.fetch = jest.fn();
	});

	it('API-SPC-TACS-01: unknown SP → NotFoundException', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(null);
		await expect(service.testAcs('c1234567890123456789012345')).rejects.toThrow(NotFoundException);
	});

	it('API-SPC-TACS-02: invalid stored ACS URL returns ok false', async () => {
		prisma.spConnection.findUnique.mockResolvedValue({ ...row, acsUrl: 'bad-url' });
		const result = await service.testAcs(row.id);
		expect(result.ok).toBe(false);
		expect(result.reachable).toBe(false);
	});

	it('API-SPC-TACS-03: reachable 200 response', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(row);
		(global.fetch as jest.Mock).mockResolvedValue({ status: 200 });

		const result = await service.testAcs(row.id);

		expect(result.ok).toBe(true);
		expect(result.statusCode).toBe(200);
		expect(audit.logAcsTested).toHaveBeenCalledWith(row.id, true, 200);
	});

	it('API-SPC-TACS-04: HTTP 405 treated as ok for ACS probe', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(row);
		(global.fetch as jest.Mock).mockResolvedValue({ status: 405 });

		const result = await service.testAcs(row.id);
		expect(result.ok).toBe(true);
	});

	it('API-SPC-TACS-05: network failure returns unreachable', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(row);
		(global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));

		const result = await service.testAcs(row.id);
		expect(result.reachable).toBe(false);
		expect(audit.logAcsTested).toHaveBeenCalledWith(row.id, false);
	});

	it('API-SPC-TACS-06: timeout returns timed out message', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(row);
		const timeout = new Error('timeout');
		timeout.name = 'TimeoutError';
		(global.fetch as jest.Mock).mockRejectedValue(timeout);

		const result = await service.testAcs(row.id);
		expect(result.message).toContain('timed out');
	});

	it('API-SPC-TACS-07: only reads SP row (no writes)', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(row);
		(global.fetch as jest.Mock).mockResolvedValue({ status: 200 });

		await service.testAcs(row.id);

		expect(prisma.spConnection.findUnique).toHaveBeenCalledTimes(1);
		expect(prisma.spConnection.findUnique).toHaveBeenCalledWith({ where: { id: row.id } });
	});

	it('API-SPC-TACS-08: response never includes spCertificate', async () => {
		prisma.spConnection.findUnique.mockResolvedValue({
			...row,
			spCertificate: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
		});
		(global.fetch as jest.Mock).mockResolvedValue({ status: 200 });

		const result = await service.testAcs(row.id);

		expect(result).not.toHaveProperty('spCertificate');
		expect(JSON.stringify(result)).not.toContain('BEGIN CERTIFICATE');
	});
});
