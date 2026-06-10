import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SpConnectionProbeSigningService } from '@api/sp-connections/services/sp-connection-probe-signing.service';
import { SpCertificateValidationError } from '@api/sp-connections/utils/sp-certificate.util';
import { MAX_PEM_LENGTH } from '@api/common/constants/crypto-limits';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';

/**
 * Unit spec for the "probe SP signing key" sign/verify roundtrip (Prompt 38 §8). The HTTP surface is
 * covered by sp-connection-request-security.integration.spec.ts (API-SP-PROBE-SIG-*).
 */
describe('SpConnectionProbeSigningService', () => {
	const prisma = {
		spConnection: { findUnique: jest.fn() },
	};
	const audit = { logSigningProbe: jest.fn() };
	const service = new SpConnectionProbeSigningService(prisma as never, audit as never);

	const spId = 'c1234567890123456789012345';
	const material = getTestSigningMaterial('urn:test:sp:probe-unit');
	const otherMaterial = getTestSigningMaterial('urn:test:sp:probe-unit-other');
	const sp = {
		id: spId,
		spEntityId: 'https://sp.example.com',
		spCertificate: material.certPem,
	};

	beforeEach(() => {
		jest.clearAllMocks();
		prisma.spConnection.findUnique.mockResolvedValue({ ...sp });
	});

	it('API-SP-PROBE-U-01: unknown SP → NotFoundException', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(null);
		await expect(
			service.probeSigning(spId, { spPrivateKeyPem: material.privateKeyPem }),
		).rejects.toThrow(NotFoundException);
	});

	it('API-SP-PROBE-U-02: SP without a stored certificate → BadRequestException', async () => {
		prisma.spConnection.findUnique.mockResolvedValue({ ...sp, spCertificate: null });
		await expect(
			service.probeSigning(spId, { spPrivateKeyPem: material.privateKeyPem }),
		).rejects.toThrow(BadRequestException);
	});

	it('API-SP-PROBE-U-03: missing or blank spPrivateKeyPem → BadRequestException', async () => {
		await expect(
			service.probeSigning(spId, { spPrivateKeyPem: undefined as unknown as string }),
		).rejects.toThrow(BadRequestException);
		await expect(service.probeSigning(spId, { spPrivateKeyPem: '   ' })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-SP-PROBE-U-04: oversized spPrivateKeyPem (> MAX_PEM_LENGTH) → BadRequestException', async () => {
		const oversized = 'A'.repeat(MAX_PEM_LENGTH + 1);
		await expect(service.probeSigning(spId, { spPrivateKeyPem: oversized })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-SP-PROBE-U-05: matching key/cert roundtrip → ok + sha256 fingerprint + positive audit', async () => {
		const result = await service.probeSigning(spId, { spPrivateKeyPem: material.privateKeyPem });

		expect(result.ok).toBe(true);
		expect(result.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(audit.logSigningProbe).toHaveBeenCalledWith(spId, sp.spEntityId, true);
	});

	it('API-SP-PROBE-U-06: mismatched private key → ok:false with message + negative audit', async () => {
		const result = await service.probeSigning(spId, {
			spPrivateKeyPem: otherMaterial.privateKeyPem,
		});

		expect(result).toEqual({ ok: false, message: 'Private key does not match SP certificate' });
		expect(audit.logSigningProbe).toHaveBeenCalledWith(spId, sp.spEntityId, false);
	});

	it('API-SP-PROBE-U-07: the response never echoes key or certificate material', async () => {
		const result = await service.probeSigning(spId, { spPrivateKeyPem: material.privateKeyPem });
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('PRIVATE KEY');
		expect(serialized).not.toContain('BEGIN CERTIFICATE');
	});

	it('API-SP-PROBE-U-08: a corrupt stored certificate currently escapes as SpCertificateValidationError', async () => {
		// Report-only observation (Prompt 38 §8): assertValidSpCertificatePem throws a plain Error
		// subclass that probeSigning does not map to an HttpException, so a garbage stored PEM would
		// surface as a 500 instead of a 400. Pinned here so any future remap is a conscious change.
		prisma.spConnection.findUnique.mockResolvedValue({ ...sp, spCertificate: 'not-a-pem' });
		await expect(
			service.probeSigning(spId, { spPrivateKeyPem: material.privateKeyPem }),
		).rejects.toThrow(SpCertificateValidationError);
	});
});
