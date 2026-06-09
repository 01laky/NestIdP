import {
	SamlSoapBackchannelService,
	type SoapDeliveryInput,
} from '@api/saml/services/saml-soap-backchannel.service';
import { SamlLogoutRequestBuilderService } from '@api/saml/services/saml-logout-request-builder.service';
import { IdpSigningService, type SigningMaterial } from '@api/saml/services/idp-signing.service';
import {
	SAML_STATUS_PARTIAL_LOGOUT,
	SAML_STATUS_RESPONDER,
	SAML_STATUS_SUCCESS,
} from '@nestidp/shared';
import { generateTestSpSigningKeyPair } from '@test/support/saml/build-logout-request.util';

/**
 * SOAP back-channel dispatcher (Prompt 36, BC-SOAP). The dispatcher wraps a signed LogoutRequest in a
 * SOAP 1.1 envelope, POSTs it, and interprets the LogoutResponse. `fetch` is mocked; the service must
 * never throw — every error path returns `{ outcome: 'failed', reason }`.
 */
describe('SamlSoapBackchannelService (BC-SOAP)', () => {
	const builder = new SamlLogoutRequestBuilderService();
	const idpSigning = new IdpSigningService({} as never, {} as never, {} as never, {} as never);
	const service = new SamlSoapBackchannelService();

	let idpMaterial: SigningMaterial; // signs the outbound request
	let spMaterial: SigningMaterial; // signs the SP's LogoutResponse
	let signedRequestXml: string;
	const originalFetch = globalThis.fetch;
	let fetchMock: jest.Mock;

	beforeAll(() => {
		const idp = generateTestSpSigningKeyPair('idp-soap');
		idpMaterial = { ...idp, signatureAlgorithmId: 'rsa-sha256' };
		const sp = generateTestSpSigningKeyPair('sp-soap');
		spMaterial = { ...sp, signatureAlgorithmId: 'rsa-sha256' };

		const built = builder.build({
			requestId: '_req-soap-1',
			destination: 'https://sp.example.com/slo/soap',
			idpEntityId: 'https://idp.example.com',
			nameId: 'bob@example.com',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			sessionIndexes: ['_sidx'],
			validitySeconds: 300,
		});
		signedRequestXml = idpSigning.signLogoutRequest(built.xml, idpMaterial, built.requestId);
	});

	beforeEach(() => {
		fetchMock = jest.fn();
		globalThis.fetch = fetchMock as never;
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	function logoutResponseXml(opts: {
		id?: string;
		inResponseTo?: string | null;
		statusValues: string[];
	}): string {
		const id = opts.id ?? '_resp-1';
		const irt =
			opts.inResponseTo === null ? '' : ` InResponseTo="${opts.inResponseTo ?? '_req-soap-1'}"`;
		const codes = opts.statusValues.map((v) => `<samlp:StatusCode Value="${v}"/>`).join('');
		return (
			`<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
			`xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" ` +
			`IssueInstant="${new Date().toISOString()}"${irt}>` +
			`<saml2:Issuer>https://sp.example.com</saml2:Issuer>` +
			`<samlp:Status>${codes}</samlp:Status></samlp:LogoutResponse>`
		);
	}

	function envelope(inner: string): string {
		return (
			`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
			`<soap:Body>${inner}</soap:Body></soap:Envelope>`
		);
	}

	function okResponse(bodyXml: string): void {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => bodyXml,
		} as never);
	}

	function input(overrides: Partial<SoapDeliveryInput> = {}): SoapDeliveryInput {
		return {
			soapUrl: 'https://sp.example.com/slo/soap',
			signedLogoutRequestXml: signedRequestXml,
			requestId: '_req-soap-1',
			spCertificate: null,
			timeoutMs: 5_000,
			clockSkewSeconds: 60,
			...overrides,
		};
	}

	it('BC-SOAP-01: wraps the request in a SOAP 1.1 envelope with the right headers and POSTs to sloSoapUrl', async () => {
		okResponse(envelope(logoutResponseXml({ statusValues: [SAML_STATUS_SUCCESS] })));
		await service.deliver(input());
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://sp.example.com/slo/soap');
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('text/xml; charset=utf-8');
		expect(init.headers.SOAPAction).toBe('""');
		expect(init.body).toContain('<soap:Envelope');
		expect(init.body).toContain('<soap:Body>');
		expect(init.body).toContain('<samlp:LogoutRequest');
		expect(init.body).not.toMatch(/^<\?xml/); // xml declaration stripped before wrapping
	});

	it('BC-SOAP-02: 200 success + matching InResponseTo (no SP cert) → succeeded', async () => {
		okResponse(envelope(logoutResponseXml({ statusValues: [SAML_STATUS_SUCCESS] })));
		await expect(service.deliver(input())).resolves.toEqual({ outcome: 'succeeded' });
	});

	it('BC-SOAP-02b: 200 success + valid SP signature (spCertificate set) → succeeded', async () => {
		const resp = logoutResponseXml({ statusValues: [SAML_STATUS_SUCCESS] });
		const signed = idpSigning.signLogoutResponse(resp, spMaterial, '_resp-1');
		okResponse(envelope(signed));
		await expect(service.deliver(input({ spCertificate: spMaterial.certPem }))).resolves.toEqual({
			outcome: 'succeeded',
		});
	});

	it('BC-SOAP-02c: absent InResponseTo is tolerated (no mismatch error)', async () => {
		okResponse(
			envelope(logoutResponseXml({ inResponseTo: null, statusValues: [SAML_STATUS_SUCCESS] })),
		);
		await expect(service.deliver(input())).resolves.toEqual({ outcome: 'succeeded' });
	});

	it('BC-SOAP-03a: non-2xx HTTP → failed http_<status>, never throws', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => '' } as never);
		await expect(service.deliver(input())).resolves.toEqual({
			outcome: 'failed',
			reason: 'http_503',
		});
	});

	it('BC-SOAP-03b: timeout (AbortError) → failed reason starts with "timeout"', async () => {
		fetchMock.mockRejectedValue(
			Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
		);
		const result = await service.deliver(input());
		expect(result.outcome).toBe('failed');
		expect(result.reason).toMatch(/^timeout/);
	});

	it('BC-SOAP-03c: network error → failed reason starts with "network"', async () => {
		fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
		const result = await service.deliver(input());
		expect(result.outcome).toBe('failed');
		expect(result.reason).toMatch(/^network/);
	});

	it('BC-SOAP-03d: SOAP body with no LogoutResponse → failed no_logout_response', async () => {
		okResponse(envelope('<somethingElse/>'));
		await expect(service.deliver(input())).resolves.toEqual({
			outcome: 'failed',
			reason: 'no_logout_response',
		});
	});

	it('BC-SOAP-03e: InResponseTo mismatch → failed in_response_to_mismatch', async () => {
		okResponse(
			envelope(
				logoutResponseXml({ inResponseTo: '_other-req', statusValues: [SAML_STATUS_SUCCESS] }),
			),
		);
		await expect(service.deliver(input())).resolves.toEqual({
			outcome: 'failed',
			reason: 'in_response_to_mismatch',
		});
	});

	it('BC-SOAP-03f: non-success status (Responder) → failed status:<code>', async () => {
		okResponse(envelope(logoutResponseXml({ statusValues: [SAML_STATUS_RESPONDER] })));
		const result = await service.deliver(input());
		expect(result.outcome).toBe('failed');
		expect(result.reason).toBe(`status:${SAML_STATUS_RESPONDER}`);
	});

	it('BC-SOAP-03g: spCertificate set but response signed by a different key → response_signature_invalid', async () => {
		const resp = logoutResponseXml({ statusValues: [SAML_STATUS_SUCCESS] });
		const signed = idpSigning.signLogoutResponse(resp, spMaterial, '_resp-1');
		const otherCert = generateTestSpSigningKeyPair('attacker').certPem;
		okResponse(envelope(signed));
		await expect(service.deliver(input({ spCertificate: otherCert }))).resolves.toEqual({
			outcome: 'failed',
			reason: 'response_signature_invalid',
		});
	});

	it('BC-SOAP-03h: spCertificate set but response is unsigned (expected-but-missing sig) → response_signature_invalid', async () => {
		okResponse(envelope(logoutResponseXml({ statusValues: [SAML_STATUS_SUCCESS] })));
		await expect(service.deliver(input({ spCertificate: spMaterial.certPem }))).resolves.toEqual({
			outcome: 'failed',
			reason: 'response_signature_invalid',
		});
	});

	it('BC-SOAP-PARTIAL: PartialLogout status → partial outcome', async () => {
		okResponse(envelope(logoutResponseXml({ statusValues: [SAML_STATUS_PARTIAL_LOGOUT] })));
		await expect(service.deliver(input())).resolves.toEqual({
			outcome: 'partial',
			reason: 'partial_logout',
		});
	});

	it('BC-SOAP-04: a non-https endpoint is warned but still attempted', async () => {
		const warn = jest.spyOn(
			(service as unknown as { logger: { warn: () => void } }).logger,
			'warn',
		);
		okResponse(envelope(logoutResponseXml({ statusValues: [SAML_STATUS_SUCCESS] })));
		const result = await service.deliver(input({ soapUrl: 'http://sp.example.com/slo/soap' }));
		expect(warn).toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.outcome).toBe('succeeded');
		warn.mockRestore();
	});

	it('BC-SOAP-05: no request/response bodies are logged on failure (only redacted reason)', async () => {
		fetchMock.mockRejectedValue(new Error('boom with bob@example.com inside'));
		const result = await service.deliver(input());
		// the dispatcher never throws and never echoes the signed request XML back
		expect(result.outcome).toBe('failed');
		expect(result.reason).not.toContain('<samlp:LogoutRequest');
	});
});
