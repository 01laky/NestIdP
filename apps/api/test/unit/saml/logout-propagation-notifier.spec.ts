import { Logger } from '@nestjs/common';
import {
	NoopLogoutPropagationNotifier,
	type LogoutPropagationNotification,
	type LogoutPropagationNotifier,
} from '@api/saml/services/logout-propagation-notifier';
import { LogoutPropagationService } from '@api/saml/services/logout-propagation.service';
import type { PrismaService } from '@api/prisma/services/prisma.service';
import type { BackchannelLogoutConfig } from '@api/saml/services/backchannel-logout.config';
import type { SamlLogoutRequestBuilderService } from '@api/saml/services/saml-logout-request-builder.service';
import type { IdpSigningService } from '@api/saml/services/idp-signing.service';
import type { SamlSoapBackchannelService } from '@api/saml/services/saml-soap-backchannel.service';
import type { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';

/**
 * LogoutPropagationNotifier (Prompt 36 / Prompt 38 §8) — the default no-op notifier's logging
 * contract, and the engine-side guarantee that a misbehaving custom notifier can never make
 * processDue() reject (delivery is fire-and-forget towards the notifier).
 */
describe('NoopLogoutPropagationNotifier', () => {
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;
	const notifier = new NoopLogoutPropagationNotifier();

	const notification: LogoutPropagationNotification = {
		ssoSessionId: 'sess-1',
		spConnectionId: 'sp-1',
		spEntityId: 'https://sp.example.com',
		reason: 'admin_action',
		attempts: 2,
	};

	beforeEach(() => {
		logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
	});

	function parsed(spy: jest.SpyInstance): Record<string, unknown> {
		expect(spy).toHaveBeenCalledTimes(1);
		return JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
	}

	it('BC-NOTIF-01: onSent logs backchannel_logout_sent at log level with the full payload', () => {
		notifier.onSent(notification);
		const entry = parsed(logSpy);
		expect(entry).toEqual({ event: 'backchannel_logout_sent', ...notification });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('BC-NOTIF-02: onSucceeded logs backchannel_logout_succeeded at log level', () => {
		notifier.onSucceeded(notification);
		const entry = parsed(logSpy);
		expect(entry).toEqual({ event: 'backchannel_logout_succeeded', ...notification });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('BC-NOTIF-03: onFailed warns backchannel_logout_failed including the redacted error', () => {
		notifier.onFailed({ ...notification, error: 'http_503' });
		const entry = parsed(warnSpy);
		expect(entry).toEqual({
			event: 'backchannel_logout_failed',
			...notification,
			error: 'http_503',
		});
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('BC-NOTIF-04: onGivenUp warns backchannel_logout_given_up', () => {
		notifier.onGivenUp({ ...notification, error: 'network' });
		const entry = parsed(warnSpy);
		expect(entry.event).toBe('backchannel_logout_given_up');
		expect(entry.error).toBe('network');
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('BC-NOTIF-05: the log line carries exactly the notification fields (no secrets, no extras)', () => {
		notifier.onSent(notification);
		const entry = parsed(logSpy);
		expect(Object.keys(entry).sort()).toEqual(['event', ...Object.keys(notification)].sort());
	});
});

describe('LogoutPropagationService with a throwing notifier (never propagates)', () => {
	const row = {
		id: 'row-1',
		ssoSessionId: 'sess-1',
		spConnectionId: 'sp-1',
		sessionIndex: '_idx',
		nameId: 'user@example.com',
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		reason: 'admin_action',
		attempts: 0,
		requestId: '_req-1',
	};

	const prisma = {
		samlBackchannelLogout: {
			count: jest.fn(),
			findMany: jest.fn(),
			updateMany: jest.fn(),
			update: jest.fn(),
		},
		spConnection: {
			findUnique: jest.fn(),
			update: jest.fn(),
		},
		idpSettings: {
			findUnique: jest.fn(),
		},
	};

	const config = {
		firstPassBudgetMs: () => 0,
		maxInFlight: () => 5,
		concurrency: () => 2,
		maxRetries: () => 2,
		retryBaseMs: () => 1_000,
		retryMaxMs: () => 60_000,
		validitySeconds: () => 120,
		httpTimeoutMs: () => 5_000,
		clockSkewSeconds: () => 60,
		pruneRetentionMs: () => 1_000,
	} as unknown as BackchannelLogoutConfig;

	const builder = {
		build: jest.fn(() => ({ xml: '<LogoutRequest/>' })),
	} as unknown as SamlLogoutRequestBuilderService;
	const signing = {
		ensureSigningMaterial: jest.fn(async () => ({})),
		signLogoutRequest: jest.fn(() => '<Signed/>'),
	} as unknown as IdpSigningService;
	const deliver = jest.fn();
	const soap = { deliver } as unknown as SamlSoapBackchannelService;
	const audit = { recordSafe: jest.fn() } as unknown as AuditPersistenceService;

	function makeService(notifier: LogoutPropagationNotifier): LogoutPropagationService {
		return new LogoutPropagationService(
			prisma as unknown as PrismaService,
			config,
			builder,
			signing,
			soap,
			audit,
			notifier,
		);
	}

	function throwingNotifier(): LogoutPropagationNotifier {
		const boom = () => {
			throw new Error('notifier exploded');
		};
		return { onSent: boom, onSucceeded: boom, onFailed: boom, onGivenUp: boom };
	}

	beforeEach(() => {
		jest.clearAllMocks();
		// silence the engine's structured warn logging during the failure-path tests
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		prisma.samlBackchannelLogout.count.mockResolvedValue(0);
		prisma.samlBackchannelLogout.findMany.mockResolvedValue([{ ...row }]);
		prisma.samlBackchannelLogout.updateMany.mockResolvedValue({ count: 1 });
		prisma.samlBackchannelLogout.update.mockResolvedValue({});
		prisma.spConnection.findUnique.mockResolvedValue({
			id: 'sp-1',
			spEntityId: 'https://sp.example.com',
			sloSoapUrl: 'https://sp.example.com/slo/soap',
			spCertificate: 'PEM',
		});
		prisma.spConnection.update.mockResolvedValue({});
		prisma.idpSettings.findUnique.mockResolvedValue({ entityId: 'http://localhost:3000' });
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('BC-NOTIF-NOTHROW-01: a sync-throwing notifier on a succeeded delivery never rejects processDue', async () => {
		deliver.mockResolvedValue({ outcome: 'succeeded' });
		const service = makeService(throwingNotifier());
		await expect(service.processDue()).resolves.toBe(1);
	});

	it('BC-NOTIF-NOTHROW-02: a sync-throwing notifier on a failed delivery never rejects processDue', async () => {
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'network' });
		const service = makeService(throwingNotifier());
		await expect(service.processDue()).resolves.toBe(1);
	});

	it('BC-NOTIF-NOTHROW-03: a sync-throwing notifier on give-up (attempts > maxRetries) never rejects', async () => {
		prisma.samlBackchannelLogout.findMany.mockResolvedValue([{ ...row, attempts: 5 }]);
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'network' });
		const service = makeService(throwingNotifier());
		await expect(service.processDue()).resolves.toBe(1);
	});

	it('BC-NOTIF-NOTHROW-04: an async-rejecting notifier never rejects processDue either', async () => {
		// NOTE: the engine `void`s the hook result without `.catch`, so a *raw* rejecting promise from a
		// custom notifier surfaces as an unhandled rejection at process level (report-only finding). The
		// pre-handled rejection here still proves processDue itself never rejects on async hook failure.
		const rejected = Promise.reject(new Error('async notifier exploded'));
		rejected.catch(() => undefined);
		const reject = jest.fn().mockReturnValue(rejected);
		deliver.mockResolvedValue({ outcome: 'succeeded' });
		const service = makeService({
			onSent: reject,
			onSucceeded: reject,
			onFailed: reject,
			onGivenUp: reject,
		});
		await expect(service.processDue()).resolves.toBe(1);
		expect(reject).toHaveBeenCalled();
	});

	it('BC-NOTIF-PAYLOAD-01: onSent/onSucceeded receive the notification without an error field', async () => {
		const hooks = {
			onSent: jest.fn(),
			onSucceeded: jest.fn(),
			onFailed: jest.fn(),
			onGivenUp: jest.fn(),
		};
		deliver.mockResolvedValue({ outcome: 'succeeded' });
		await makeService(hooks).processDue();

		const expected = {
			ssoSessionId: 'sess-1',
			spConnectionId: 'sp-1',
			spEntityId: 'https://sp.example.com',
			reason: 'admin_action',
			attempts: 1,
			error: undefined,
		};
		expect(hooks.onSent).toHaveBeenCalledWith(expected);
		expect(hooks.onSucceeded).toHaveBeenCalledWith(expected);
		expect(hooks.onFailed).not.toHaveBeenCalled();
		expect(hooks.onGivenUp).not.toHaveBeenCalled();
	});

	it('BC-NOTIF-PAYLOAD-02: onFailed carries the failure reason as error', async () => {
		const hooks = {
			onSent: jest.fn(),
			onSucceeded: jest.fn(),
			onFailed: jest.fn(),
			onGivenUp: jest.fn(),
		};
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'http_503' });
		await makeService(hooks).processDue();

		expect(hooks.onFailed).toHaveBeenCalledWith(
			expect.objectContaining({ error: 'http_503', attempts: 1 }),
		);
		expect(hooks.onSucceeded).not.toHaveBeenCalled();
	});

	it('BC-NOTIF-PAYLOAD-03: onGivenUp fires once attempts exceed maxRetries', async () => {
		const hooks = {
			onSent: jest.fn(),
			onSucceeded: jest.fn(),
			onFailed: jest.fn(),
			onGivenUp: jest.fn(),
		};
		prisma.samlBackchannelLogout.findMany.mockResolvedValue([{ ...row, attempts: 5 }]);
		deliver.mockResolvedValue({ outcome: 'failed', reason: 'network' });
		await makeService(hooks).processDue();

		expect(hooks.onGivenUp).toHaveBeenCalledWith(
			expect.objectContaining({ error: 'network', attempts: 6 }),
		);
		expect(hooks.onFailed).not.toHaveBeenCalled();
	});
});
