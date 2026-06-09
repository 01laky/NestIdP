import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SamlLogoutService } from '@api/saml/services/saml-logout.service';
import { SamlLogoutResponseBuilderService } from '@api/saml/services/saml-logout-response-builder.service';
import { SamlPostBindingService } from '@api/saml/services/saml-post-binding.service';
import { verifyRedirectBindingSignature } from '@api/saml/utils/saml-authn-request-redirect-signature.util';
import {
	buildPlainLogoutPostBody,
	buildPlainLogoutRedirect,
	buildSignedLogoutPostBody,
	buildSignedLogoutRedirect,
	generateTestEcSigningKeyPair,
	generateTestSpSigningKeyPair,
} from '@test/support/saml/build-logout-request.util';

const SP_ENTITY = 'urn:test:sp';
const SLO_URL = 'https://sp.example/slo';

describe('saml-logout.service', () => {
	let sp: { privateKeyPem: string; certPem: string };
	let idp: { privateKeyPem: string; certPem: string };

	beforeAll(() => {
		sp = generateTestSpSigningKeyPair('sp');
		idp = generateTestSpSigningKeyPair('idp');
	});

	function makeService(
		overrides: {
			spConnection?: Record<string, unknown> | null;
			match?: { ssoSessionId: string } | null;
			recordThrows?: boolean;
			idpMaterial?: { certPem: string; privateKeyPem: string; signatureAlgorithmId: string };
			terminateResult?: { found: boolean; alreadyTerminated: boolean };
			noIdpSettings?: boolean;
		} = {},
	) {
		const spConnection =
			overrides.spConnection === undefined
				? {
						id: 'sp1',
						spEntityId: SP_ENTITY,
						active: true,
						spCertificate: sp.certPem,
						wantLogoutRequestsSigned: false,
						sloUrl: SLO_URL,
					}
				: overrides.spConnection;

		const prisma = {
			idpSettings: {
				findUnique: jest
					.fn()
					.mockResolvedValue(
						overrides.noIdpSettings ? null : { id: 'default', entityId: 'https://idp.example' },
					),
			},
			spConnection: { findUnique: jest.fn().mockResolvedValue(spConnection) },
		};
		const configService = {
			get: (key: string) => (key === 'IDP_BASE_URL' ? 'http://localhost:3000' : undefined),
		} as unknown as ConfigService;
		const sessions = {
			recordLogoutRequestId: overrides.recordThrows
				? jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
				: jest.fn().mockResolvedValue(undefined),
			findMatchingForLogout: jest.fn().mockResolvedValue(overrides.match ?? null),
			terminate: jest
				.fn()
				.mockResolvedValue(overrides.terminateResult ?? { found: true, alreadyTerminated: false }),
		};
		const idpSigning = {
			ensureSigningMaterial: jest.fn().mockResolvedValue(
				overrides.idpMaterial ?? {
					certPem: idp.certPem,
					privateKeyPem: idp.privateKeyPem,
					signatureAlgorithmId: 'rsa-sha256',
				},
			),
			signLogoutResponse: jest.fn().mockReturnValue('<signed/>'),
		};
		const audit = {
			logLogoutRequestReceived: jest.fn(),
			logLogoutRequestRejected: jest.fn(),
			logLogoutCompleted: jest.fn(),
		};
		const service = new SamlLogoutService(
			prisma as never,
			configService,
			sessions as never,
			idpSigning as never,
			new SamlLogoutResponseBuilderService(),
			new SamlPostBindingService(),
			audit as never,
		);
		return { service, prisma, sessions, idpSigning, audit };
	}

	it('API-SLO-INT-01: signed Redirect SLO terminates session and delivers Redirect LogoutResponse', async () => {
		const { service, sessions } = makeService({ match: { ssoSessionId: 'sso1' } });
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			nameId: 'a@e.com',
			sessionIndex: '_si',
			spPrivateKeyPem: sp.privateKeyPem,
		});
		const result = await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			relayState: signed.relayState,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: '1.2.3.4',
		});
		expect(sessions.terminate).toHaveBeenCalledWith('sso1', 'sp_logout', undefined, {
			excludeSpConnectionId: 'sp1',
		});
		expect(result.clearEndUserCookie).toBe(true);
		expect(result.delivery.type).toBe('redirect');
		if (result.delivery.type === 'redirect') {
			expect(result.delivery.url).toContain(SLO_URL);
			expect(result.delivery.url).toContain('SAMLResponse=');
		}
	});

	it('API-SLO-INT-02: signed POST SLO delivers an auto-post form', async () => {
		const { service, idpSigning } = makeService({ match: { ssoSessionId: 'sso1' } });
		const post = buildSignedLogoutPostBody({
			issuer: SP_ENTITY,
			nameId: 'a@e.com',
			spPrivateKeyPem: sp.privateKeyPem,
			spCertificatePem: sp.certPem,
		});
		const result = await service.handlePostSlo({
			samlRequest: post.samlRequest,
			clientIp: '1.2.3.4',
		});
		expect(idpSigning.signLogoutResponse).toHaveBeenCalled();
		expect(result.delivery.type).toBe('post');
	});

	it('API-SLO-INT-04: missing sloUrl → logged-out delivery, no redirect', async () => {
		const { service } = makeService({
			match: { ssoSessionId: 'sso1' },
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: true,
				spCertificate: sp.certPem,
				wantLogoutRequestsSigned: false,
				sloUrl: null,
			},
		});
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		const result = await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: '1.2.3.4',
		});
		expect(result.delivery.type).toBe('logged-out');
		expect(result.clearEndUserCookie).toBe(true);
	});

	it('API-SLO-INT-05: unknown/inactive SP issuer → rejected', async () => {
		const { service, audit } = makeService({ spConnection: null });
		const plain = buildPlainLogoutRedirect({ issuer: 'urn:unknown:sp' });
		await expect(
			service.handleRedirectSlo({ samlRequest: plain.samlRequest, raw: {}, clientIp: '1.2.3.4' }),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'unknown_or_inactive_sp',
			'1.2.3.4',
			'redirect',
		);
	});

	it('API-SLO-SIG-05: wantLogoutRequestsSigned + unsigned → unsigned_logout_required', async () => {
		const { service, audit } = makeService({
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: true,
				spCertificate: sp.certPem,
				wantLogoutRequestsSigned: true,
				sloUrl: SLO_URL,
			},
		});
		const plain = buildPlainLogoutRedirect({ issuer: SP_ENTITY });
		await expect(
			service.handleRedirectSlo({
				samlRequest: plain.samlRequest,
				raw: { samlRequest: plain.samlRequest },
				clientIp: 'ip',
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'unsigned_logout_required',
			'ip',
			'redirect',
		);
	});

	it('API-SLO-SIG-02: tampered Redirect signature → invalid_logout_signature', async () => {
		const { service, audit } = makeService();
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await expect(
			service.handleRedirectSlo({
				samlRequest: signed.samlRequest,
				raw: {
					samlRequest: signed.samlRequest,
					sigAlg: signed.sigAlg,
					signature: encodeURIComponent('bogus'),
				},
				clientIp: 'ip',
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'invalid_logout_signature',
			'ip',
			'redirect',
		);
	});

	it('API-SLO-REPLAY-01: duplicate LogoutRequest id → logout_request_replayed', async () => {
		const { service, audit } = makeService({ recordThrows: true, match: { ssoSessionId: 'sso1' } });
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await expect(
			service.handleRedirectSlo({
				samlRequest: signed.samlRequest,
				raw: {
					samlRequest: signed.samlRequest,
					sigAlg: signed.sigAlg,
					signature: signed.signature,
				},
				clientIp: 'ip',
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'logout_request_replayed',
			'ip',
			'redirect',
		);
	});

	it('API-SLO-MATCH-03: no active session matched → still success (idempotent)', async () => {
		const { service, sessions, audit } = makeService({ match: null });
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		const result = await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: 'ip',
		});
		expect(sessions.terminate).not.toHaveBeenCalled();
		expect(result.delivery.type).toBe('redirect');
		expect(audit.logLogoutCompleted).toHaveBeenCalledWith(
			expect.objectContaining({ sessionTerminated: false, responseDelivered: true }),
		);
	});

	it('API-SLO-SIG-06: no cert + unsigned is accepted (best effort)', async () => {
		const { service } = makeService({
			match: { ssoSessionId: 'sso1' },
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: true,
				spCertificate: null,
				wantLogoutRequestsSigned: false,
				sloUrl: SLO_URL,
			},
		});
		const plain = buildPlainLogoutRedirect({ issuer: SP_ENTITY });
		const result = await service.handleRedirectSlo({
			samlRequest: plain.samlRequest,
			raw: { samlRequest: plain.samlRequest },
			clientIp: 'ip',
		});
		expect(result.delivery.type).toBe('redirect');
	});

	it('EDGE: Destination mismatch → logout_destination_mismatch', async () => {
		const { service, audit } = makeService();
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			destination: 'https://evil.example/slo',
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await expect(
			service.handleRedirectSlo({
				samlRequest: signed.samlRequest,
				raw: {
					samlRequest: signed.samlRequest,
					sigAlg: signed.sigAlg,
					signature: signed.signature,
				},
				clientIp: 'ip',
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'logout_destination_mismatch',
			'ip',
			'redirect',
		);
	});

	it('EDGE: matching Destination is accepted', async () => {
		const { service } = makeService({ match: { ssoSessionId: 'sso1' } });
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			destination: 'http://localhost:3000/saml/slo',
			spPrivateKeyPem: sp.privateKeyPem,
		});
		const result = await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: 'ip',
		});
		expect(result.delivery.type).toBe('redirect');
	});

	it('EDGE: IdP not configured → ServiceUnavailable + audit', async () => {
		const { service, audit } = makeService({ noIdpSettings: true });
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await expect(
			service.handleRedirectSlo({
				samlRequest: signed.samlRequest,
				raw: {
					samlRequest: signed.samlRequest,
					sigAlg: signed.sigAlg,
					signature: signed.signature,
				},
				clientIp: 'ip',
			}),
		).rejects.toThrow();
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'idp_not_configured',
			'ip',
			'redirect',
		);
	});

	it('EDGE: inactive SP → unknown_or_inactive_sp', async () => {
		const { service, audit } = makeService({
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: false,
				spCertificate: sp.certPem,
				wantLogoutRequestsSigned: false,
				sloUrl: SLO_URL,
			},
		});
		const plain = buildPlainLogoutRedirect({ issuer: SP_ENTITY });
		await expect(
			service.handleRedirectSlo({ samlRequest: plain.samlRequest, raw: {}, clientIp: 'ip' }),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'unknown_or_inactive_sp',
			'ip',
			'redirect',
		);
	});

	it('EDGE: signature present but SP has no cert → sp_certificate_required_for_signature', async () => {
		const { service, audit } = makeService({
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: true,
				spCertificate: null,
				wantLogoutRequestsSigned: false,
				sloUrl: SLO_URL,
			},
		});
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await expect(
			service.handleRedirectSlo({
				samlRequest: signed.samlRequest,
				raw: {
					samlRequest: signed.samlRequest,
					sigAlg: signed.sigAlg,
					signature: signed.signature,
				},
				clientIp: 'ip',
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'sp_certificate_required_for_signature',
			'ip',
			'redirect',
		);
	});

	it('EDGE: unsupported SigAlg → unsupported_signature_algorithm', async () => {
		const { service, audit } = makeService();
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await expect(
			service.handleRedirectSlo({
				samlRequest: signed.samlRequest,
				raw: {
					samlRequest: signed.samlRequest,
					sigAlg: encodeURIComponent('http://example.com/unknown-sigalg'),
					signature: signed.signature,
				},
				clientIp: 'ip',
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'unsupported_signature_algorithm',
			'ip',
			'redirect',
		);
	});

	it('EDGE: POST unsigned + wantLogoutRequestsSigned → unsigned_logout_required', async () => {
		const { service, audit } = makeService({
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: true,
				spCertificate: sp.certPem,
				wantLogoutRequestsSigned: true,
				sloUrl: SLO_URL,
			},
		});
		const post = buildPlainLogoutPostBody({ issuer: SP_ENTITY });
		await expect(
			service.handlePostSlo({ samlRequest: post.samlRequest, clientIp: 'ip' }),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'unsigned_logout_required',
			'ip',
			'post',
		);
	});

	it('EDGE: POST signature verified against the wrong SP cert → invalid_logout_signature', async () => {
		// Request signed by `sp`, but the SP connection holds a different cert (`idp`).
		const { service, audit } = makeService({
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: true,
				spCertificate: idp.certPem,
				wantLogoutRequestsSigned: false,
				sloUrl: SLO_URL,
			},
		});
		const post = buildSignedLogoutPostBody({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
			spCertificatePem: sp.certPem,
		});
		await expect(
			service.handlePostSlo({ samlRequest: post.samlRequest, clientIp: 'ip' }),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(audit.logLogoutRequestRejected).toHaveBeenCalledWith(
			'invalid_logout_signature',
			'ip',
			'post',
		);
	});

	it('EDGE: POST deflate-encoded body rejected', async () => {
		const { service } = makeService();
		const redirect = buildPlainLogoutRedirect({ issuer: SP_ENTITY }); // deflate+base64
		const deflatedBase64 = decodeURIComponent(redirect.samlRequest);
		await expect(
			service.handlePostSlo({ samlRequest: deflatedBase64, clientIp: 'ip' }),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('EDGE: empty SAMLRequest → BadRequest', async () => {
		const { service } = makeService();
		await expect(
			service.handleRedirectSlo({ samlRequest: '', raw: {}, clientIp: 'ip' }),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('EDGE: EC IdP signing key → Redirect LogoutResponse signed with ecdsa-sha256 (verifies)', async () => {
		const ec = generateTestEcSigningKeyPair('ec-idp');
		const { service } = makeService({
			match: { ssoSessionId: 'sso1' },
			idpMaterial: {
				certPem: ec.certPem,
				privateKeyPem: ec.privateKeyPem,
				signatureAlgorithmId: 'ecdsa-sha256',
			},
		});
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		const result = await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: 'ip',
		});
		expect(result.delivery.type).toBe('redirect');
		if (result.delivery.type === 'redirect') {
			const query = result.delivery.url.split('?')[1];
			const params = new URLSearchParams(query);
			const sigAlg = params.get('SigAlg')!;
			expect(decodeURIComponent(sigAlg)).toContain('ecdsa-sha256');
			// Re-verify the outbound signature against the IdP cert.
			const signedContent = `SAMLResponse=${encodeURIComponent(params.get('SAMLResponse')!)}&SigAlg=${encodeURIComponent(sigAlg)}`;
			const ok = verifyRedirectBindingSignature({
				signedContent,
				signatureBase64UrlEncoded: encodeURIComponent(params.get('Signature')!),
				sigAlgUri: decodeURIComponent(sigAlg),
				certificatePem: ec.certPem,
			});
			expect(ok).toBe(true);
		}
	});

	it('EDGE: sloUrl already containing a query string uses & separator', async () => {
		const { service } = makeService({
			match: { ssoSessionId: 'sso1' },
			spConnection: {
				id: 'sp1',
				spEntityId: SP_ENTITY,
				active: true,
				spCertificate: sp.certPem,
				wantLogoutRequestsSigned: false,
				sloUrl: 'https://sp.example/slo?foo=bar',
			},
		});
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		const result = await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: 'ip',
		});
		expect(result.delivery.type).toBe('redirect');
		if (result.delivery.type === 'redirect') {
			expect(result.delivery.url).toContain('?foo=bar&SAMLResponse=');
		}
	});

	it('EDGE: already-terminated match reports sessionTerminated=false', async () => {
		const { service, audit } = makeService({
			match: { ssoSessionId: 'sso1' },
			terminateResult: { found: true, alreadyTerminated: true },
		});
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: 'ip',
		});
		expect(audit.logLogoutCompleted).toHaveBeenCalledWith(
			expect.objectContaining({ sessionTerminated: false }),
		);
	});

	it('EDGE: accepted request audits logLogoutRequestReceived with binding + signed flag', async () => {
		const { service, audit } = makeService({ match: { ssoSessionId: 'sso1' } });
		const signed = buildSignedLogoutRedirect({
			issuer: SP_ENTITY,
			spPrivateKeyPem: sp.privateKeyPem,
		});
		await service.handleRedirectSlo({
			samlRequest: signed.samlRequest,
			raw: { samlRequest: signed.samlRequest, sigAlg: signed.sigAlg, signature: signed.signature },
			clientIp: 'ip',
		});
		expect(audit.logLogoutRequestReceived).toHaveBeenCalledWith(
			expect.objectContaining({
				spConnectionId: 'sp1',
				bindingType: 'redirect',
				requestWasSigned: true,
			}),
		);
	});
});
