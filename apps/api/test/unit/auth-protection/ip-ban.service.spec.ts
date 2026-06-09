import { IpBanService } from '@api/auth-protection/ip-ban.service';
import type { RateLimitConfig } from '@api/auth-protection/rate-limit.config';

function makeConfig(threshold: number, windowMs = 10_000, banMs = 5000): RateLimitConfig {
	return {
		ipBanThreshold: jest.fn(() => threshold),
		ipBanWindowMs: jest.fn(() => windowMs),
		ipBanMs: jest.fn(() => banMs),
	} as unknown as RateLimitConfig;
}

describe('IpBanService (Prompt 35)', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it('BAN-01: bans an IP once trips cross the threshold (deduped on transition)', () => {
		const svc = new IpBanService(makeConfig(3));
		expect(svc.recordTrip('1.2.3.4').bannedNow).toBe(false); // 1
		expect(svc.recordTrip('1.2.3.4').bannedNow).toBe(false); // 2
		const third = svc.recordTrip('1.2.3.4'); // 3 → ban
		expect(third.bannedNow).toBe(true);
		expect(third.bannedUntil).not.toBeNull();
		expect(svc.recordTrip('1.2.3.4').bannedNow).toBe(false); // already banned → not re-announced
		expect(svc.check('1.2.3.4').banned).toBe(true);
	});

	it('BAN-PRUNE-01: prune evicts expired bans, bounding the map (§5.B14)', () => {
		const svc = new IpBanService(makeConfig(1, 10_000, 5000));
		svc.recordTrip('1.1.1.1');
		svc.recordTrip('2.2.2.2');
		// not yet expired → nothing pruned
		expect(svc.prune(0)).toBe(0);
		expect(svc.check('1.1.1.1').banned).toBe(true);
		// after the ban window both are expired → both pruned
		expect(svc.prune(6000)).toBe(2);
		expect(svc.check('1.1.1.1').banned).toBe(false);
	});

	it('BAN-02: the ban auto-expires (never permanent)', () => {
		const svc = new IpBanService(makeConfig(1, 10_000, 5000));
		svc.recordTrip('9.9.9.9');
		expect(svc.check('9.9.9.9').banned).toBe(true);
		jest.setSystemTime(5001);
		expect(svc.check('9.9.9.9').banned).toBe(false);
	});

	it('BAN-03: threshold 0 disables the escalation layer', () => {
		const svc = new IpBanService(makeConfig(0));
		for (let i = 0; i < 20; i += 1) {
			expect(svc.recordTrip('5.5.5.5').bannedNow).toBe(false);
		}
		expect(svc.check('5.5.5.5').banned).toBe(false);
	});

	it('clear resets all ban + trip state', () => {
		const svc = new IpBanService(makeConfig(1));
		svc.recordTrip('1.1.1.1');
		expect(svc.check('1.1.1.1').banned).toBe(true);
		svc.clear();
		expect(svc.check('1.1.1.1').banned).toBe(false);
	});
});
