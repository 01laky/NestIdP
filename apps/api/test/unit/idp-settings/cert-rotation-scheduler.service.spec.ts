import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CertRotationSchedulerService } from '@api/idp-settings/services/cert-rotation-scheduler.service';

describe('CertRotationSchedulerService (Prompt 34)', () => {
	const idpSettingsService = { runAutoRotationCheck: jest.fn().mockResolvedValue({}) };
	const config = { tickMs: jest.fn(() => 1000), jitterMaxSeconds: jest.fn(() => 0) };
	const configService = { get: jest.fn(() => undefined) } as unknown as ConfigService;

	function make(): CertRotationSchedulerService {
		return new CertRotationSchedulerService(
			idpSettingsService as never,
			config as never,
			configService,
		);
	}

	beforeEach(() => {
		jest.clearAllMocks();
		// clearAllMocks resets call history but NOT implementations — restore the default resolving stub so
		// a prior test's custom mockImplementation (e.g. the re-entrancy hang) cannot leak forward.
		idpSettingsService.runAutoRotationCheck.mockReset();
		idpSettingsService.runAutoRotationCheck.mockResolvedValue({});
		config.tickMs.mockReturnValue(1000);
		config.jitterMaxSeconds.mockReturnValue(0);
	});

	it('CERT-ROT-SCHED-01: tickMs=0 disables the scheduler (no interval, no check)', () => {
		config.tickMs.mockReturnValue(0);
		jest.useFakeTimers();
		const svc = make();
		svc.onModuleInit();
		jest.advanceTimersByTime(10_000);
		expect(idpSettingsService.runAutoRotationCheck).not.toHaveBeenCalled();
		svc.onModuleDestroy();
		jest.useRealTimers();
	});

	it('CERT-ROT-SCHED-01b: MIGRATE_ONLY skips the scheduler', () => {
		(configService.get as jest.Mock).mockImplementation((k: string) =>
			k === 'MIGRATE_ONLY' ? '1' : undefined,
		);
		jest.useFakeTimers();
		const svc = make();
		svc.onModuleInit();
		jest.advanceTimersByTime(5000);
		expect(idpSettingsService.runAutoRotationCheck).not.toHaveBeenCalled();
		svc.onModuleDestroy();
		jest.useRealTimers();
		(configService.get as jest.Mock).mockImplementation(() => undefined);
	});

	it('CERT-ROT-SCHED-02 + boot: first tick is boot, then scheduled; destroy clears the interval', async () => {
		jest.useFakeTimers();
		const svc = make();
		svc.onModuleInit();

		await jest.advanceTimersByTimeAsync(1000);
		expect(idpSettingsService.runAutoRotationCheck).toHaveBeenCalledWith({ trigger: 'boot' });

		await jest.advanceTimersByTimeAsync(1000);
		expect(idpSettingsService.runAutoRotationCheck).toHaveBeenLastCalledWith({
			trigger: 'scheduled',
		});

		svc.onModuleDestroy();
		const callsAfterDestroy = idpSettingsService.runAutoRotationCheck.mock.calls.length;
		await jest.advanceTimersByTimeAsync(5000);
		expect(idpSettingsService.runAutoRotationCheck.mock.calls.length).toBe(callsAfterDestroy);
		jest.useRealTimers();
	});

	it('CERT-ROT-SCHED-04: re-entrancy — a tick still running is not entered twice', async () => {
		let resolveCheck: () => void = () => {};
		idpSettingsService.runAutoRotationCheck.mockImplementation(
			() => new Promise<void>((r) => (resolveCheck = r)),
		);
		const svc = make();
		const first = svc.runTick();
		const second = svc.runTick(); // should be skipped — first still in flight (ticking flag is sync)
		await Promise.resolve();
		await Promise.resolve();
		expect(idpSettingsService.runAutoRotationCheck).toHaveBeenCalledTimes(1);
		resolveCheck();
		await Promise.all([first, second]);
	});

	it('a thrown check never escapes the tick', async () => {
		idpSettingsService.runAutoRotationCheck.mockRejectedValueOnce(new Error('boom'));
		const svc = make();
		await expect(svc.runTick()).resolves.toBeUndefined();
	});

	it('CERT-ROT-START-08: a configured jitter still lets the tick fire (bounded real delay)', async () => {
		// jitter shells out to a real setTimeout bounded by jitterMaxSeconds; keep it tiny so the test is
		// fast but still exercises the non-zero jitter branch.
		config.jitterMaxSeconds.mockReturnValue(1);
		const svc = make();
		const started = Date.now();
		await svc.runTick();
		expect(idpSettingsService.runAutoRotationCheck).toHaveBeenCalledWith({ trigger: 'boot' });
		expect(Date.now() - started).toBeLessThan(1100); // delay stays within the 1s jitter bound
	});

	it('CERT-ROT-START-08b: jitter 0 runs the tick synchronously (no deferral)', async () => {
		config.jitterMaxSeconds.mockReturnValue(0);
		const svc = make();
		await svc.runTick();
		expect(idpSettingsService.runAutoRotationCheck).toHaveBeenCalledTimes(1);
	});

	it('CERT-ROT-SCHED-06: tickStats is null before the first tick, then records lastTickAt + kinds evaluated', async () => {
		const svc = make();
		expect(svc.tickStats()).toEqual({ lastTickAt: null, lastProcessed: null });

		await svc.runTick();

		const stats = svc.tickStats();
		expect(stats.lastProcessed).toBe(2); // signing + encryption evaluated per check
		expect(stats.lastTickAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('CERT-ROT-SCHED-06b: a failed tick still stamps lastTickAt but not lastProcessed', async () => {
		const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		try {
			idpSettingsService.runAutoRotationCheck.mockRejectedValueOnce(new Error('boom'));
			const svc = make();
			await svc.runTick();
			const stats = svc.tickStats();
			expect(stats.lastTickAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(stats.lastProcessed).toBeNull();
		} finally {
			warnSpy.mockRestore();
		}
	});

	it('CERT-ROT-SCHED-05: a completed tick logs cert_rotation_tick_completed with durationMs + trigger', async () => {
		const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		try {
			const svc = make();
			await svc.runTick();
			const line = logSpy.mock.calls
				.map((c) => String(c[0]))
				.find((l) => l.includes('cert_rotation_tick_completed'));
			expect(line).toBeDefined();
			const parsed = JSON.parse(line!) as { event: string; durationMs: number; trigger: string };
			expect(parsed.event).toBe('cert_rotation_tick_completed');
			expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
			expect(parsed.trigger).toBe('boot');
		} finally {
			logSpy.mockRestore();
		}
	});

	it('CERT-ROT-SCHED-05b: a failed tick does not log tick_completed', async () => {
		const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		try {
			idpSettingsService.runAutoRotationCheck.mockRejectedValueOnce(new Error('boom'));
			const svc = make();
			await svc.runTick();
			const completed = logSpy.mock.calls
				.map((c) => String(c[0]))
				.find((l) => l.includes('cert_rotation_tick_completed'));
			expect(completed).toBeUndefined();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cert_rotation_tick_failed'));
		} finally {
			logSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});
});
