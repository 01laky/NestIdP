import { SamlAuthAuditService } from '@api/saml/services/saml-auth-audit.service';

describe('SamlAuthAuditService', () => {
	const audit = { recordSafe: jest.fn() };
	const service = new SamlAuthAuditService(audit as never);
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;

	beforeEach(() => {
		logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
		warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('API-SAML-AUDIT-01: saml_request_received event', () => {
		service.logRequestReceived({
			spEntityId: 'urn:sp:1',
			samlRequestId: '_req',
			spConnectionId: 'sp-1',
			clientIp: '127.0.0.1',
			requestWasSigned: false,
			requestWasEncrypted: false,
		});
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"saml_request_received"'));
	});

	it('API-SAML-AUDIT-02: saml_request_rejected without XML body', () => {
		service.logRequestRejected('invalid_issuer', '10.0.0.1');
		const payload = warnSpy.mock.calls[0][0] as string;
		expect(payload).toContain('saml_request_rejected');
		expect(payload).not.toContain('<?xml');
		expect(payload).not.toContain('SAMLRequest');
	});

	it('API-SAML-AUDIT-03: saml_response_issued event', () => {
		service.logResponseIssued({
			samlSessionId: 'sess-1',
			userId: 'u-1',
			spEntityId: 'urn:sp:1',
		});
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"saml_response_issued"'));
	});

	it('API-SAML-AUDIT-04: saml_response_failed event', () => {
		service.logResponseFailed('sess-1', 'expired');
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"saml_response_failed"'));
	});

	it('API-SAML-AUDIT-05: idp_signing_key_generated has no key material', () => {
		service.logSigningKeyGenerated();
		const payload = logSpy.mock.calls[0][0] as string;
		expect(payload).toContain('idp_signing_key_generated');
		expect(payload).not.toContain('BEGIN');
		expect(payload).not.toContain('privateKey');
	});

	it('API-SAML-POST-AUDIT-01: logRequestReceived with bindingType=post emits it in payload', () => {
		service.logRequestReceived({
			spEntityId: 'urn:sp:post',
			samlRequestId: '_post-audit',
			spConnectionId: 'sp-post',
			clientIp: '10.1.1.1',
			requestWasSigned: false,
			requestWasEncrypted: false,
			bindingType: 'post',
		});
		const payload = logSpy.mock.calls[0][0] as string;
		expect(payload).toContain('"bindingType":"post"');
	});

	it('API-SAML-POST-AUDIT-02: logRequestReceived with bindingType=redirect emits redirect', () => {
		service.logRequestReceived({
			spEntityId: 'urn:sp:redirect',
			samlRequestId: '_redirect-audit',
			spConnectionId: 'sp-redir',
			clientIp: '10.1.1.2',
			requestWasSigned: false,
			requestWasEncrypted: false,
			bindingType: 'redirect',
		});
		const payload = logSpy.mock.calls[0][0] as string;
		expect(payload).toContain('"bindingType":"redirect"');
	});

	it('API-SAML-POST-AUDIT-03: logRequestRejected with bindingType emits it in rejected payload', () => {
		service.logRequestRejected('invalid_destination', '10.0.0.1', 'post');
		const payload = warnSpy.mock.calls[0][0] as string;
		expect(payload).toContain('saml_request_rejected');
		expect(payload).toContain('"bindingType":"post"');
	});
});
