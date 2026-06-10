import { Logger, NotFoundException } from '@nestjs/common';
import { ApiConnectionTestService } from '@api/api-connections/services/api-connection-test.service';
import type { CredentialsEncryptionPort } from '@api/encryption/credentials-encryption.port';
import { fakeProxyDispatcher } from '@test/support/proxy-dispatcher.mock';

describe('ApiConnectionTestService', () => {
	const encryption: jest.Mocked<CredentialsEncryptionPort> = {
		encrypt: jest.fn(),
		decrypt: jest.fn().mockReturnValue('plain-bearer-token'),
	};

	const prisma = {
		apiConnection: {
			findUnique: jest.fn(),
			update: jest.fn(),
		},
	};

	const audit = { logTested: jest.fn(), logProxyChecked: jest.fn() };
	const oauthTokenService = {
		getAccessToken: jest.fn(),
		getLastTokenAt: jest.fn().mockReturnValue(null),
		fetchDiagnostics: jest.fn(),
	};
	const identitySyncClient = {
		getMaxUsersPerRun: jest.fn().mockReturnValue(10_000),
	};
	const service = new ApiConnectionTestService(
		prisma as never,
		encryption,
		audit as never,
		oauthTokenService as never,
		fakeProxyDispatcher(),
		identitySyncClient as never,
	);

	const connection = {
		id: 'c1234567890123456789012345',
		name: 'Test',
		baseUrl: 'https://identity.example.com',
		authType: 'BEARER' as const,
		authCredentialsEncrypted: 'enc',
		lastSyncAt: null,
		lastSyncStatus: 'NEVER' as const,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	beforeEach(() => {
		jest.clearAllMocks();
		encryption.decrypt.mockReturnValue('plain-bearer-token');
		prisma.apiConnection.findUnique.mockResolvedValue(connection);
		identitySyncClient.getMaxUsersPerRun.mockReturnValue(10_000);
	});

	it('API-CON-TST-01: external 200 → ok true, reachable true, statusCode 200', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
		} as Response);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({ ok: true, reachable: true, statusCode: 200 });
	});

	it('API-CON-TST-02: external 401 → ok false, reachable true, statusCode 401', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 401,
		} as Response);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({ ok: false, reachable: true, statusCode: 401 });
	});

	it('API-CON-TST-03: fetch throws → ok false, reachable false', async () => {
		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({ ok: false, reachable: false });
	});

	it('API-CON-TST-04: request URL is baseUrl/users (contract usersPath) with Authorization header', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue({ status: 200, json: async () => [] } as Response);

		await service.testConnection(connection.id);

		expect(fetchMock).toHaveBeenCalledWith(
			new URL('/users', 'https://identity.example.com').toString(),
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({ Authorization: 'Bearer plain-bearer-token' }),
			}),
		);
	});

	it('API-CON-TST-06: unknown connection id → 404', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(null);
		await expect(service.testConnection('missing')).rejects.toThrow(NotFoundException);
	});

	it('API-CON-TST-07: timeout → ok false, reachable false, timed out message', async () => {
		const timeoutError = Object.assign(new Error('Timeout'), { name: 'TimeoutError' });
		jest.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({
			ok: false,
			reachable: false,
			message: 'Identity API request timed out',
		});
	});

	it('API-CON-TST-08: decrypt failure → ok false without throwing', async () => {
		encryption.decrypt.mockImplementation(() => {
			throw new Error('bad ciphertext');
		});

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({
			ok: false,
			reachable: false,
			message: 'Stored credentials could not be decrypted',
		});
	});

	it('API-CON-TST-09: external HTTP 500 → ok false but reachable', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({ status: 500 } as Response);

		const result = await service.testConnection(connection.id);
		expect(result).toMatchObject({
			ok: false,
			reachable: true,
			statusCode: 500,
		});
	});

	it('API-CON-TST-10: logger never receives full bearer token', async () => {
		const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		encryption.decrypt.mockReturnValue('abcdefghijklmnop-token-value');
		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

		await service.testConnection(connection.id);

		for (const call of warnSpy.mock.calls) {
			const joined = call.join(' ');
			expect(joined).not.toContain('abcdefghijklmnop-token-value');
		}
		warnSpy.mockRestore();
	});

	it('API-CON-TST-11: baseUrl with path joins /users correctly', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...connection,
			baseUrl: 'https://identity.example.com/api/v1',
		});
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue({ status: 200, json: async () => [] } as Response);

		await service.testConnection(connection.id);

		expect(fetchMock).toHaveBeenCalledWith(
			new URL('/users', 'https://identity.example.com/api/v1').toString(),
			expect.any(Object),
		);
	});

	it('API-CONTRACT-E6-01: previewSample (no passwordHash) + previewUsersCount on success', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(connection);
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [
				{
					id: 'u1',
					username: 'alice',
					email: 'alice@example.com',
					displayName: 'Alice',
					passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
					passwordHashAlgorithm: 'bcrypt',
					active: true,
				},
			],
		} as Response);

		const result = await service.testConnection(connection.id);
		expect(result.previewUsersCount).toBe(1);
		expect(result.previewSample?.[0]).toMatchObject({ id: 'u1', username: 'alice' });
		expect(JSON.stringify(result.previewSample)).not.toContain('"passwordHash"');
		expect(JSON.stringify(result.previewSample)).not.toContain('$2b$');
	});

	it('API-CON-TST-CAP: preview obeys the sync users-per-run cap → clear contractError (§5.C)', async () => {
		identitySyncClient.getMaxUsersPerRun.mockReturnValue(2);
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () =>
				Array.from({ length: 3 }, (_, i) => ({
					id: `u${i}`,
					username: `user${i}`,
					passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
					passwordHashAlgorithm: 'bcrypt',
					active: true,
				})),
		} as Response);

		const result = await service.testConnection(connection.id);

		expect(result.ok).toBe(true); // HTTP reachability is fine — only the contract parse is capped
		expect(result.contractError).toMatch(/User count exceeds limit of 2/);
		expect(result.previewUsersCount).toBeUndefined();
		expect(result.previewSample).toBeUndefined();
	});

	it('API-APICONN-CONTRACT-05: mapping failure → contractError naming field + path', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...connection,
			apiContractConfig: { userFieldMap: { username: 'profile.login' } },
		});
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [
				{
					id: 'u1',
					profile: {},
					passwordHash: '$2b$12$x',
					passwordHashAlgorithm: 'bcrypt',
					active: true,
				},
			],
		} as Response);

		const result = await service.testConnection(connection.id);
		expect(result.contractError).toMatch(/username.*profile\.login/);
	});

	it('API-CONTRACT-E8-01: per-collection probe reports groups endpoint HTTP status', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce({
				status: 200,
				json: async () => [
					{
						id: 'u1',
						username: 'a',
						passwordHash: '$2b$12$x',
						passwordHashAlgorithm: 'bcrypt',
						active: true,
					},
				],
			} as Response)
			.mockResolvedValueOnce({ status: 404 } as Response);

		const result = await service.testConnection(connection.id);
		expect(result.previewUsersCount).toBe(1);
		expect(result.contractError).toBe('groups endpoint: HTTP 404');
	});

	it('API-CONTRACT-E8-02: embedded membership → no per-collection probe', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...connection,
			apiContractConfig: {
				membershipSource: {
					groups: { mode: 'embedded', embeddedPath: 'groups' },
					roles: { mode: 'embedded', embeddedPath: 'roles' },
				},
			},
		});
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [
				{
					id: 'u1',
					username: 'a',
					passwordHash: '$2b$12$x',
					passwordHashAlgorithm: 'bcrypt',
					active: true,
				},
			],
		} as Response);

		const result = await service.testConnection(connection.id);
		expect(result.contractError).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1); // users only — no group/role probe
	});

	it('EDGE: custom usersPath used for the test request URL', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue({
			...connection,
			apiContractConfig: { endpoints: { usersPath: '/v1/accounts' } },
		});
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue({ status: 200, json: async () => [] } as Response);
		await service.testConnection(connection.id);
		expect(fetchMock).toHaveBeenCalledWith(
			new URL('/v1/accounts', 'https://identity.example.com').toString(),
			expect.any(Object),
		);
	});

	const oauthConnection = { ...connection, authType: 'OAUTH2_CLIENT_CREDENTIALS' as const };

	it('OAUTH-TST-01: token endpoint failure → ok:false, /users never called', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.fetchDiagnostics.mockResolvedValue({
			diag: {
				ok: false,
				reachable: true,
				statusCode: 401,
				error: 'token endpoint: HTTP 401 (invalid_client)',
			},
		});
		const fetchMock = jest.spyOn(global, 'fetch');

		const result = await service.testConnection(oauthConnection.id);

		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/token endpoint/);
		expect(result.tokenEndpoint).toMatchObject({ ok: false, statusCode: 401 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('OAUTH-TST-02: token ok → uses token for users probe + reports tokenEndpoint', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.fetchDiagnostics.mockResolvedValue({
			token: 'access-1',
			diag: { ok: true, reachable: true, statusCode: 200, tokenType: 'Bearer', expiresIn: 3600 },
		});
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue({ status: 200, json: async () => [] } as Response);

		const result = await service.testConnection(oauthConnection.id);

		expect(result.ok).toBe(true);
		expect(result.tokenEndpoint).toMatchObject({ ok: true, tokenType: 'Bearer' });
		const [, init] = fetchMock.mock.calls[0];
		expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
			'Bearer access-1',
		);
	});

	it('OAUTH-TST-03: testToken on a BEARER connection → not configured', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(connection);
		const result = await service.testToken(connection.id);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/not configured/i);
	});

	it('OAUTH-TST-04: testToken returns masked diagnostics, never the token', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.fetchDiagnostics.mockResolvedValue({
			token: 'should-not-leak',
			diag: {
				ok: true,
				reachable: true,
				statusCode: 200,
				tokenType: 'Bearer',
				expiresIn: 1800,
				grantedScope: 'read',
			},
		});
		const result = await service.testToken(oauthConnection.id);
		expect(result).toMatchObject({
			ok: true,
			tokenType: 'Bearer',
			expiresIn: 1800,
			grantedScope: 'read',
		});
		expect(JSON.stringify(result)).not.toContain('should-not-leak');
	});

	it('OAUTH-TST-05: token ok but users endpoint 500 → ok false, tokenEndpoint still reported', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.fetchDiagnostics.mockResolvedValue({
			token: 'access-1',
			diag: { ok: true, reachable: true, statusCode: 200, tokenType: 'Bearer', expiresIn: 3600 },
		});
		jest.spyOn(global, 'fetch').mockResolvedValue({ status: 500 } as Response);

		const result = await service.testConnection(oauthConnection.id);

		expect(result.ok).toBe(false);
		expect(result.statusCode).toBe(500);
		expect(result.tokenEndpoint).toMatchObject({ ok: true });
	});

	it('OAUTH-TST-06: token endpoint TLS/network failure → reachable false, distinct message', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(oauthConnection);
		oauthTokenService.fetchDiagnostics.mockResolvedValue({
			diag: {
				ok: false,
				reachable: false,
				tlsError: true,
				error: 'token endpoint TLS error: CERT_HAS_EXPIRED',
			},
		});
		const fetchMock = jest.spyOn(global, 'fetch');

		const result = await service.testConnection(oauthConnection.id);

		expect(result).toMatchObject({ ok: false, reachable: false });
		expect(result.message).toMatch(/TLS error/);
		expect(result.tokenEndpoint?.tlsError).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	describe('proxy wiring + test-proxy', () => {
		const marker = { __dispatcher: true };
		function proxiedService() {
			return new ApiConnectionTestService(
				prisma as never,
				encryption,
				audit as never,
				oauthTokenService as never,
				fakeProxyDispatcher({ proxied: true, dispatcher: marker }),
				identitySyncClient as never,
			);
		}

		it('PROXY-WIRE-03a: testConnection routes through the dispatcher + reports viaProxy', async () => {
			const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 200 } as Response);
			const result = await proxiedService().testConnection(connection.id);
			const init = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
			expect(init.dispatcher).toBe(marker);
			expect(result.viaProxy).toBe(true);
			expect(result.message).toMatch(/through the proxy/i);
		});

		it('PROXY-WIRE-03b: a proxied failure reads distinctly from a direct failure', async () => {
			jest.spyOn(global, 'fetch').mockRejectedValue(
				Object.assign(new TypeError('fetch failed'), {
					cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
				}),
			);
			const result = await proxiedService().testConnection(connection.id);
			expect(result.ok).toBe(false);
			expect(result.viaProxy).toBe(true);
			expect(result.message).toMatch(/proxy/i);
		});

		it('PROXY-TEST-01: test-proxy probes the proxy hop, persists status, never returns the password', async () => {
			const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 405 } as Response);
			const result = await proxiedService().testProxy(connection.id);
			const init = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
			expect(init.dispatcher).toBe(marker);
			expect(result).toMatchObject({ ok: true, status: 'ok', viaProxy: true, bypassed: false });
			expect(prisma.apiConnection.update).toHaveBeenCalledWith(
				expect.objectContaining({ data: expect.objectContaining({ lastProxyCheckStatus: 'ok' }) }),
			);
			expect(audit.logProxyChecked).toHaveBeenCalled();
			expect(JSON.stringify(result)).not.toMatch(/password/i);
		});

		it('PROXY-TEST-01b: test-proxy classifies a 407 as auth_failed', async () => {
			jest.spyOn(global, 'fetch').mockRejectedValue(
				Object.assign(new TypeError('fetch failed'), {
					cause: Object.assign(new Error('aborted'), {
						name: 'AbortError',
						code: 'UND_ERR_ABORTED',
						message: 'Proxy response (407) !== 200 when HTTP Tunneling',
					}),
				}),
			);
			const result = await proxiedService().testProxy(connection.id);
			expect(result).toMatchObject({ ok: false, status: 'auth_failed' });
		});

		it('PROXY-TEST-02: test-proxy is a no-op (bypassed) when proxy is off', async () => {
			const fetchMock = jest.spyOn(global, 'fetch');
			// default service uses a non-proxied dispatcher (isProxied=false)
			const result = await service.testProxy(connection.id);
			expect(result).toMatchObject({
				ok: true,
				status: 'bypassed',
				viaProxy: false,
				bypassed: true,
			});
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('PROXY-TEST-03: a target that responds non-2xx through the proxy still means the proxy hop is OK', async () => {
			jest.spyOn(global, 'fetch').mockResolvedValue({ status: 503 } as Response);
			const result = await proxiedService().testProxy(connection.id);
			expect(result).toMatchObject({ ok: true, status: 'ok', viaProxy: true });
			expect(result.message).toMatch(/503/);
		});

		it('PROXY-TEST-04: a TLS failure through the proxy → tls_error', async () => {
			jest.spyOn(global, 'fetch').mockRejectedValue(
				Object.assign(new TypeError('fetch failed'), {
					cause: Object.assign(new Error('cert'), { code: 'CERT_HAS_EXPIRED' }),
				}),
			);
			const result = await proxiedService().testProxy(connection.id);
			expect(result).toMatchObject({ ok: false, status: 'tls_error' });
		});

		it('PROXY-TEST-05: a tunnel rejection (CONNECT 502) → tunnel_failed', async () => {
			jest.spyOn(global, 'fetch').mockRejectedValue(
				Object.assign(new TypeError('fetch failed'), {
					cause: Object.assign(new Error('aborted'), {
						name: 'AbortError',
						code: 'UND_ERR_ABORTED',
						message: 'Proxy response (502) !== 200 when HTTP Tunneling',
					}),
				}),
			);
			const result = await proxiedService().testProxy(connection.id);
			expect(result).toMatchObject({ ok: false, status: 'tunnel_failed' });
		});

		it('PROXY-TEST-06: a not-found connection → 404 NotFoundException', async () => {
			prisma.apiConnection.findUnique.mockResolvedValueOnce(null);
			await expect(proxiedService().testProxy('missing')).rejects.toBeInstanceOf(NotFoundException);
		});

		it('PROXY-WIRE-03c: a non-2xx target through the proxy keeps viaProxy + statusCode on testConnection', async () => {
			jest.spyOn(global, 'fetch').mockResolvedValue({ status: 502 } as Response);
			const result = await proxiedService().testConnection(connection.id);
			expect(result).toMatchObject({ ok: false, reachable: true, statusCode: 502, viaProxy: true });
		});

		it('PROXY-SEC-PROXYCHECK: a proxy error message never leaks credentials (redacted)', async () => {
			jest
				.spyOn(global, 'fetch')
				.mockRejectedValue(
					new Error('connect failed for http://puser:psecret@proxy.corp.example:8080'),
				);
			const result = await proxiedService().testProxy(connection.id);
			expect(JSON.stringify(result)).not.toMatch(/psecret/);
		});
	});
});
