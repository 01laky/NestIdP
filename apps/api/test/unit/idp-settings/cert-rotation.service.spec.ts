import { ConfigService } from '@nestjs/config';
import type { IdpSettings } from '@prisma/client';
import { IdpSettingsService } from '@api/idp-settings/services/idp-settings.service';
import { getTestSigningMaterialWithDays } from '@test/support/prisma/test-fixtures';

/**
 * Automatic certificate rotation state machine (Prompt 34). Uses a mock CertRotationConfig so the
 * lead/overlap/threshold decisions are deterministic, and a real signing cert PEM (controlled validity)
 * so the expiry parsing is exercised for real.
 */
describe('IdpSettingsService — automatic rotation', () => {
	let cert10d: { certPem: string; privateKeyPem: string };
	let pendingCert: { certPem: string; privateKeyPem: string };

	beforeAll(() => {
		cert10d = getTestSigningMaterialWithDays('https://idp.example.com', 10);
		pendingCert = getTestSigningMaterialWithDays('https://idp-pending.example.com', 365);
	});

	const prisma = { idpSettings: { findUnique: jest.fn(), update: jest.fn() } };
	const configService = {
		get: jest.fn((k: string) => (k === 'IDP_BASE_URL' ? 'http://localhost:3000' : undefined)),
	} as unknown as ConfigService;
	const encryptionService = { encrypt: jest.fn((v: string) => `enc:${v}`) };
	const idpSigningService = {
		generateKeyPairAndCert: jest.fn(() => ({
			certPem: cert10d.certPem,
			privateKeyPem: cert10d.privateKeyPem,
			metadata: {
				signingKeyFamily: 'rsa' as const,
				signingSignatureAlgorithmId: 'rsa-sha256',
				signingRsaModulusBits: 2048,
				signingEcCurve: null,
			},
		})),
	};
	const idpEncryptionService = { generateKeyPairAndCert: jest.fn() };
	const samlMetadataService = { generateMetadata: jest.fn() };
	const audit = {
		logAutoRotationStarted: jest.fn(),
		logAutoRotationCompleted: jest.fn(),
		logAutoRotationDueSoon: jest.fn(),
		logAutoRotationFailed: jest.fn(),
		logAutoRotationAutodisabled: jest.fn(),
		logAutoRotationCheckRun: jest.fn(),
		logAutoRotationSettingChanged: jest.fn(),
	};
	const notifier = {
		onAutoRotationDueSoon: jest.fn(),
		onAutoRotationStarted: jest.fn(),
		onAutoRotationCompleted: jest.fn(),
		onAutoRotationFailed: jest.fn(),
	};
	const config = {
		tickMs: jest.fn(() => 3_600_000),
		leadDays: jest.fn((_kind: string) => 30),
		overlapDays: jest.fn((_kind: string) => 7),
		validityDays: jest.fn(() => 365),
		notifyLeadDays: jest.fn(() => 45),
		jitterMaxSeconds: jest.fn(() => 0),
		bootGraceHours: jest.fn(() => 0),
		failureAutodisableThreshold: jest.fn(() => 5),
		dryRun: jest.fn(() => false),
	};

	function service(): IdpSettingsService {
		return new IdpSettingsService(
			prisma as never,
			configService,
			encryptionService as never,
			idpSigningService as never,
			idpEncryptionService as never,
			samlMetadataService as never,
			audit as never,
			config as never,
			notifier as never,
		);
	}

	function makeSettings(overrides: Partial<IdpSettings> = {}): IdpSettings {
		return {
			id: 'default',
			entityId: 'https://idp.example.com',
			signingCertPem: cert10d.certPem,
			signingKeyEncrypted: 'enc:key',
			signingKeyFamily: 'rsa',
			signingSignatureAlgorithmId: 'rsa-sha256',
			signingRsaModulusBits: 2048,
			signingEcCurve: null,
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			pendingSigningKeyFamily: null,
			pendingSigningSignatureAlgorithmId: null,
			pendingSigningRsaModulusBits: null,
			pendingSigningEcCurve: null,
			rotationStartedAt: null,
			encryptionCertPem: null,
			encryptionKeyEncrypted: null,
			encryptionKeyFamily: null,
			encryptionKeyTransportAlgorithmId: null,
			encryptionRsaModulusBits: null,
			encryptionEcCurve: null,
			pendingEncryptionCertPem: null,
			pendingEncryptionKeyEncrypted: null,
			pendingEncryptionKeyFamily: null,
			pendingEncryptionKeyTransportAlgorithmId: null,
			pendingEncryptionRsaModulusBits: null,
			pendingEncryptionEcCurve: null,
			encryptionRotationStartedAt: null,
			autoRotateSigningEnabled: false,
			autoRotateEncryptionEnabled: false,
			lastAutoRotationCheckAt: null,
			lastAutoRotationActionAt: null,
			signingAutoRotationLastError: null,
			encryptionAutoRotationLastError: null,
			signingAutoRotationConsecutiveFailures: 0,
			encryptionAutoRotationConsecutiveFailures: 0,
			signingAutoRotationDisabledAt: null,
			encryptionAutoRotationDisabledAt: null,
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			wantAuthnRequestsSigned: false,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			updatedAt: new Date('2026-01-01T00:00:00Z'),
			...overrides,
		} as IdpSettings;
	}

	/** prisma.update returns the row merged with the data it was called with. */
	function wireDb(initial: IdpSettings): void {
		let current = initial;
		prisma.idpSettings.findUnique.mockImplementation(async () => current);
		prisma.idpSettings.update.mockImplementation(async ({ data }) => {
			current = { ...current, ...data };
			return current;
		});
	}

	beforeEach(() => {
		jest.clearAllMocks();
		config.leadDays.mockReturnValue(30);
		config.overlapDays.mockReturnValue(7);
		config.notifyLeadDays.mockReturnValue(45);
		config.bootGraceHours.mockReturnValue(0);
		config.failureAutodisableThreshold.mockReturnValue(5);
		config.dryRun.mockReturnValue(false);
	});

	it('CERT-ROT-START-01: enabled + expiring within lead → auto-starts (generate + system audit + notify)', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).toHaveBeenCalledTimes(1);
		const startCall = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.pendingSigningCertPem,
		);
		expect(startCall).toBeDefined();
		expect(audit.logAutoRotationStarted).toHaveBeenCalledWith('signing', false, expect.anything());
		expect(notifier.onAutoRotationStarted).toHaveBeenCalled();
	});

	it('CERT-ROT-START-03: auto-rotate off → no start even if expiring', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: false }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
	});

	it('CERT-ROT-START-02: not within lead window → no start', async () => {
		config.leadDays.mockReturnValue(1); // cert is ~10 days out → not within 1 day
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
	});

	it('CERT-ROT-START-04: rotation already active → no second start', async () => {
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: cert10d.certPem,
				pendingSigningKeyEncrypted: 'enc:pend',
				rotationStartedAt: new Date(), // just started → overlap not elapsed
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
		expect(audit.logAutoRotationCompleted).not.toHaveBeenCalled();
	});

	it('CERT-ROT-START-05: enabled but no active cert → skipped (never bootstraps)', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: true, signingCertPem: null }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
	});

	it('CERT-ROT-START-05b: backoff-disabled cert is skipped', async () => {
		wireDb(
			makeSettings({ autoRotateSigningEnabled: true, signingAutoRotationDisabledAt: new Date() }),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
	});

	it('CERT-ROT-DONE-01: active rotation + overlap elapsed → auto-completes (promotes pending)', async () => {
		config.overlapDays.mockReturnValue(0);
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: pendingCert.certPem,
				pendingSigningKeyEncrypted: 'enc:pend',
				pendingSigningKeyFamily: 'rsa',
				rotationStartedAt: new Date(Date.now() - 86_400_000),
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		const completeCall = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.signingCertPem === pendingCert.certPem,
		);
		expect(completeCall).toBeDefined();
		expect(completeCall![0].data.pendingSigningCertPem).toBeNull();
		expect(audit.logAutoRotationCompleted).toHaveBeenCalledWith('signing', false);
		expect(notifier.onAutoRotationCompleted).toHaveBeenCalled();
	});

	it('CERT-ROT-DONE-02: active rotation, overlap not elapsed → waits', async () => {
		config.overlapDays.mockReturnValue(7);
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: pendingCert.certPem,
				pendingSigningKeyEncrypted: 'enc',
				rotationStartedAt: new Date(),
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(audit.logAutoRotationCompleted).not.toHaveBeenCalled();
	});

	it('CERT-ROT-DUE-01: within notify lead but outside start lead → due-soon notify + audit, no rotation', async () => {
		config.leadDays.mockReturnValue(1);
		config.notifyLeadDays.mockReturnValue(60);
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(notifier.onAutoRotationDueSoon).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'signing' }),
		);
		expect(audit.logAutoRotationDueSoon).toHaveBeenCalled();
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
	});

	it('CERT-ROT-DRY-01: dry-run → would_auto_start audited, NO generate, NO pending write', async () => {
		config.dryRun.mockReturnValue(true);
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
		expect(audit.logAutoRotationStarted).toHaveBeenCalledWith('signing', true, expect.anything());
		const pendingWrite = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.pendingSigningCertPem,
		);
		expect(pendingWrite).toBeUndefined();
	});

	it('CERT-ROT-BOOT-02: on boot, in lead window but outside boot grace → defers; within grace → starts', async () => {
		config.bootGraceHours.mockReturnValue(1); // cert ~10 days out → far beyond 1h grace
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'boot' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();

		jest.clearAllMocks();
		config.leadDays.mockReturnValue(30);
		config.bootGraceHours.mockReturnValue(1_000_000); // huge grace → urgent → start on boot
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'boot' });
		expect(idpSigningService.generateKeyPairAndCert).toHaveBeenCalled();
	});

	it('CERT-ROT-BACKOFF-01: generation failure increments counter, audits failed, autodisables at threshold', async () => {
		config.failureAutodisableThreshold.mockReturnValue(3);
		idpSigningService.generateKeyPairAndCert.mockImplementationOnce(() => {
			throw new Error('openssl boom');
		});
		wireDb(
			makeSettings({ autoRotateSigningEnabled: true, signingAutoRotationConsecutiveFailures: 2 }),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(audit.logAutoRotationFailed).toHaveBeenCalledWith('signing', expect.any(String), 3);
		expect(audit.logAutoRotationAutodisabled).toHaveBeenCalledWith('signing', 3);
		expect(notifier.onAutoRotationFailed).toHaveBeenCalled();
		const disableWrite = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.signingAutoRotationDisabledAt,
		);
		expect(disableWrite).toBeDefined();
	});

	it('CERT-ROT-IND-01: signing failure does not stop encryption evaluation; the tick never throws', async () => {
		idpSigningService.generateKeyPairAndCert.mockImplementationOnce(() => {
			throw new Error('boom');
		});
		// encryption not enabled → just confirm no throw + signing failure recorded
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await expect(service().runAutoRotationCheck({ trigger: 'scheduled' })).resolves.toBeDefined();
		expect(audit.logAutoRotationFailed).toHaveBeenCalledWith('signing', expect.any(String), 1);
	});

	it('on-demand run-check audits the admin trigger then evaluates', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: false }));
		await service().runAutoRotationCheckOnDemand();
		expect(audit.logAutoRotationCheckRun).toHaveBeenCalledWith(false);
	});

	// --- extended edge cases ---------------------------------------------------------------------

	it('CERT-ROT-ENC-01: encryption auto-rotates independently (uses the encryption generator)', async () => {
		idpEncryptionService.generateKeyPairAndCert.mockReturnValue({
			certPem: pendingCert.certPem,
			privateKeyPem: pendingCert.privateKeyPem,
			metadata: {
				encryptionKeyFamily: 'rsa',
				encryptionKeyTransportAlgorithmId: 'rsa-oaep',
				encryptionRsaModulusBits: 3072,
				encryptionEcCurve: null,
			},
		});
		wireDb(
			makeSettings({
				autoRotateEncryptionEnabled: true,
				encryptionCertPem: cert10d.certPem,
				encryptionKeyEncrypted: 'enc:enckey',
				encryptionKeyFamily: 'rsa',
				encryptionKeyTransportAlgorithmId: 'rsa-oaep',
				encryptionRsaModulusBits: 3072,
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpEncryptionService.generateKeyPairAndCert).toHaveBeenCalledTimes(1);
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled(); // signing untouched
		expect(audit.logAutoRotationStarted).toHaveBeenCalledWith(
			'encryption',
			false,
			expect.anything(),
		);
	});

	it('CERT-ROT-START-VAL-01: generated pending cert uses notAfter = today + validityDays', async () => {
		config.validityDays.mockReturnValue(200);
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		const opts = (idpSigningService.generateKeyPairAndCert.mock.calls[0] as unknown[])[1] as {
			notAfter: string;
		};
		const expected = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
		expect(opts.notAfter).toBe(expected);
	});

	it('CERT-ROT-DRY-02: dry-run does not promote an overlap-elapsed rotation', async () => {
		config.dryRun.mockReturnValue(true);
		config.overlapDays.mockReturnValue(0);
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: pendingCert.certPem,
				pendingSigningKeyEncrypted: 'enc:pend',
				rotationStartedAt: new Date(Date.now() - 86_400_000),
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(audit.logAutoRotationCompleted).toHaveBeenCalledWith('signing', true);
		const promote = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.signingCertPem === pendingCert.certPem,
		);
		expect(promote).toBeUndefined();
	});

	it('CERT-ROT-CLAMP-01: overlap is clamped to the active cert expiry (completes earlier than configured)', async () => {
		// active cert ~10 days out; configured overlap 30 → clamped to ~10; started 12 days ago → elapsed.
		config.overlapDays.mockReturnValue(30);
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: pendingCert.certPem,
				pendingSigningKeyEncrypted: 'enc:pend',
				pendingSigningKeyFamily: 'rsa',
				rotationStartedAt: new Date(Date.now() - 12 * 86_400_000),
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(audit.logAutoRotationCompleted).toHaveBeenCalledWith('signing', false);
	});

	it('CERT-ROT-REENTRANT-01: a concurrent run-check returns current state without re-processing', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		const svc = service();
		const [a, b] = await Promise.all([
			svc.runAutoRotationCheck({ trigger: 'scheduled' }),
			svc.runAutoRotationCheck({ trigger: 'scheduled' }),
		]);
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		// only one of the two concurrent calls actually generated a pending cert
		expect(idpSigningService.generateKeyPairAndCert.mock.calls.length).toBeLessThanOrEqual(1);
	});

	// --- additional edge cases (Prompt 34 hardening) ---------------------------------------------

	it('CERT-ROT-SCHED-03: each evaluation re-reads fresh settings (a toggle flipped between ticks is honoured)', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: false }));
		const svc = service();
		await svc.runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
		// flip the toggle directly in the DB between ticks — the next tick must pick it up
		await prisma.idpSettings.update({
			where: { id: 'default' },
			data: { autoRotateSigningEnabled: true },
		});
		await svc.runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).toHaveBeenCalledTimes(1);
	});

	it('CERT-ROT-CHECK-01: lastAutoRotationCheckAt is always written, even when nothing happens', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: false }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		const checkWrite = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.lastAutoRotationCheckAt,
		);
		expect(checkWrite).toBeDefined();
	});

	it('CERT-ROT-NOTIFY-PAYLOAD-01: the started notifier payload carries only non-secret fields', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		const payload = notifier.onAutoRotationStarted.mock.calls[0][0] as Record<string, unknown>;
		expect(payload).toEqual(
			expect.objectContaining({ kind: 'signing', pendingCertNotAfter: expect.any(String) }),
		);
		const serialized = JSON.stringify(payload);
		expect(serialized).not.toMatch(/PRIVATE KEY/);
		expect(serialized).not.toMatch(/enc:/);
		expect(Object.keys(payload)).not.toContain('pendingSigningKeyEncrypted');
	});

	it('CERT-ROT-START-09: a per-cert signing lead override is honoured independently of encryption', async () => {
		// signing lead 30 (cert ~10d out → within), encryption lead 1 (cert ~10d out → outside)
		config.leadDays.mockImplementation((kind: string) => (kind === 'signing' ? 30 : 1));
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				autoRotateEncryptionEnabled: true,
				encryptionCertPem: cert10d.certPem,
				encryptionKeyEncrypted: 'enc:enckey',
				encryptionKeyFamily: 'rsa',
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).toHaveBeenCalledTimes(1);
		expect(idpEncryptionService.generateKeyPairAndCert).not.toHaveBeenCalled();
	});

	it('CERT-ROT-DONE-03: with overlap 0 a rotation completes on the next tick after start', async () => {
		config.overlapDays.mockReturnValue(0);
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: pendingCert.certPem,
				pendingSigningKeyEncrypted: 'enc:pend',
				pendingSigningKeyFamily: 'rsa',
				rotationStartedAt: new Date(), // started "now" — overlap 0 still elapses
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(audit.logAutoRotationCompleted).toHaveBeenCalledWith('signing', false);
	});

	it('CERT-ROT-DONE-04: a manually-started rotation is auto-completed once the overlap elapses', async () => {
		// rotationStartedAt is old and the operator only just enabled auto-rotate — the scheduler now owns it.
		config.overlapDays.mockReturnValue(3);
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: pendingCert.certPem,
				pendingSigningKeyEncrypted: 'enc:pend',
				pendingSigningKeyFamily: 'rsa',
				rotationStartedAt: new Date(Date.now() - 5 * 86_400_000),
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		const completeCall = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.signingCertPem === pendingCert.certPem,
		);
		expect(completeCall).toBeDefined();
		expect(audit.logAutoRotationCompleted).toHaveBeenCalledWith('signing', false);
	});

	it('CERT-ROT-DONE-05: a per-cert overlap override is threaded into the completion decision', async () => {
		// signing overlap 0 → completes; if the shared (encryption) value were used (90) it would wait.
		config.overlapDays.mockImplementation((kind: string) => (kind === 'signing' ? 0 : 90));
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				pendingSigningCertPem: pendingCert.certPem,
				pendingSigningKeyEncrypted: 'enc:pend',
				pendingSigningKeyFamily: 'rsa',
				rotationStartedAt: new Date(Date.now() - 86_400_000),
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(audit.logAutoRotationCompleted).toHaveBeenCalledWith('signing', false);
	});

	it('CERT-ROT-BACKOFF-02: a successful auto-start resets the consecutive-failure counter to 0', async () => {
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				signingAutoRotationConsecutiveFailures: 3,
				signingAutoRotationLastError: 'previous failure',
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		const startCall = prisma.idpSettings.update.mock.calls.find(
			(c) => c[0].data.pendingSigningCertPem,
		);
		expect(startCall).toBeDefined();
		expect(startCall![0].data.signingAutoRotationConsecutiveFailures).toBe(0);
		expect(startCall![0].data.signingAutoRotationLastError).toBeNull();
	});

	it('CERT-ROT-FAIL-02: an unparseable active cert PEM does not start, fail, or throw', async () => {
		wireDb(makeSettings({ autoRotateSigningEnabled: true, signingCertPem: 'not-a-valid-pem' }));
		await expect(service().runAutoRotationCheck({ trigger: 'scheduled' })).resolves.toBeDefined();
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
		expect(audit.logAutoRotationFailed).not.toHaveBeenCalled();
		expect(audit.logAutoRotationStarted).not.toHaveBeenCalled();
	});

	it('CERT-ROT-DUE-02: outside the notify lead window → no due-soon notification', async () => {
		config.leadDays.mockReturnValue(1);
		config.notifyLeadDays.mockReturnValue(2); // cert ~10d out → outside both
		wireDb(makeSettings({ autoRotateSigningEnabled: true }));
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(notifier.onAutoRotationDueSoon).not.toHaveBeenCalled();
		expect(audit.logAutoRotationDueSoon).not.toHaveBeenCalled();
		expect(idpSigningService.generateKeyPairAndCert).not.toHaveBeenCalled();
	});

	it('CERT-ROT-DRY-03: the on-demand check audits the dry-run flag it ran under', async () => {
		config.dryRun.mockReturnValue(true);
		wireDb(makeSettings({ autoRotateSigningEnabled: false }));
		await service().runAutoRotationCheckOnDemand();
		expect(audit.logAutoRotationCheckRun).toHaveBeenCalledWith(true);
	});

	it('CERT-ROT-IND-02: both certs auto-rotate independently in a single tick', async () => {
		idpEncryptionService.generateKeyPairAndCert.mockReturnValue({
			certPem: pendingCert.certPem,
			privateKeyPem: pendingCert.privateKeyPem,
			metadata: {
				encryptionKeyFamily: 'rsa',
				encryptionKeyTransportAlgorithmId: 'rsa-oaep',
				encryptionRsaModulusBits: 2048,
				encryptionEcCurve: null,
			},
		});
		wireDb(
			makeSettings({
				autoRotateSigningEnabled: true,
				autoRotateEncryptionEnabled: true,
				encryptionCertPem: cert10d.certPem,
				encryptionKeyEncrypted: 'enc:enckey',
				encryptionKeyFamily: 'rsa',
			}),
		);
		await service().runAutoRotationCheck({ trigger: 'scheduled' });
		expect(idpSigningService.generateKeyPairAndCert).toHaveBeenCalledTimes(1);
		expect(idpEncryptionService.generateKeyPairAndCert).toHaveBeenCalledTimes(1);
		expect(audit.logAutoRotationStarted).toHaveBeenCalledWith('signing', false, expect.anything());
		expect(audit.logAutoRotationStarted).toHaveBeenCalledWith(
			'encryption',
			false,
			expect.anything(),
		);
	});
});
