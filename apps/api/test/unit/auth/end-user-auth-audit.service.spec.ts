import { EndUserAuthAuditService } from '@api/auth/services/end-user-auth-audit.service';

describe('EndUserAuthAuditService', () => {
	let service: EndUserAuthAuditService;
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;
	const audit = { recordSafe: jest.fn() };

	beforeEach(() => {
		jest.clearAllMocks();
		service = new EndUserAuthAuditService(audit as never);
		logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
		warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('API-AUTH-AUDIT-01: logLoginSuccess emits structured JSON', () => {
		service.logLoginSuccess('u1', 'alice', '10.0.0.1', true);
		expect(logSpy).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'end_user_login_success',
				userId: 'u1',
				username: 'alice',
				clientIp: '10.0.0.1',
				samlSessionBound: true,
			}),
		);
		expect(audit.recordSafe).toHaveBeenCalled();
	});

	it('API-AUTH-AUDIT-02: logLoginFailure emits reason', () => {
		service.logLoginFailure('alice', '10.0.0.2', 'invalid_credentials');
		expect(logSpy).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'end_user_login_failure',
				username: 'alice',
				clientIp: '10.0.0.2',
				reason: 'invalid_credentials',
			}),
		);
	});

	it('API-AUTH-AUDIT-03: logSamlBindFailure emits session id', () => {
		service.logSamlBindFailure('session-1', '10.0.0.3', 'SAML session expired');
		expect(logSpy).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'end_user_saml_bind_failure',
				samlSessionId: 'session-1',
				clientIp: '10.0.0.3',
				reason: 'SAML session expired',
			}),
		);
	});

	it('API-AUTH-AUDIT-04: logUnsupportedAlgorithm warns with userId', () => {
		service.logUnsupportedAlgorithm('u99');
		expect(warnSpy).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'end_user_unsupported_hash_algorithm',
				userId: 'u99',
			}),
		);
	});

	it('API-AUTH-AUDIT-05: logLogout emits userId and clientIp', () => {
		service.logLogout('u1', '10.0.0.4');
		expect(logSpy).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'end_user_logout',
				userId: 'u1',
				clientIp: '10.0.0.4',
			}),
		);
	});
});
