import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ADMIN_CSRF_HEADER_NAME,
	ADMIN_USERS_API_PATH,
	API_CONNECTIONS_API_PATH,
	AUDIT_EVENTS_API_PATH,
	IDENTITY_USERS_API_PATH,
	IDP_METADATA_URL_API_PATH,
	IDP_SETTINGS_API_PATH,
	SP_CONNECTIONS_API_PATH,
	SYNC_API_PATH,
} from '@nestidp/shared';
import {
	AdminApiError,
	adminFetch,
	cancelIdpCertRotation,
	completeIdpCertRotation,
	createApiConnection,
	deleteApiConnection,
	generateIdpEncryptionCert,
	generateIdpSigningCert,
	getIdpEncryptionCertPublicPem,
	getApiConnection,
	getCsrfToken,
	getIdpMetadataPreview,
	getIdpSettings,
	getSyncLog,
	getSyncStatus,
	listApiConnections,
	listSyncLogs,
	loginAdmin,
	logoutAdmin,
	setCsrfToken,
	startIdpCertRotation,
	startIdpEncryptionCertRotation,
	completeIdpEncryptionCertRotation,
	cancelIdpEncryptionCertRotation,
	uploadIdpEncryptionCert,
	testApiConnection,
	triggerIdentitySync,
	updateApiConnection,
	updateIdpSettings,
	uploadIdpSigningCert,
	getAdminMe,
	getIdpMetadataUrl,
	getSpConnection,
	getSpConnectionTestSsoUrl,
	listSpConnections,
	listAdminUsers,
	createAdminUser,
	updateAdminUser,
	deleteAdminUser,
	unlockAdminUser,
	unlockIdentityUser,
	changeAdminPassword,
	listAuditEvents,
	probeSpConnectionSigning,
	auditExportUrl,
} from '@/admin/adminApi';

describe('adminApi', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		setCsrfToken(null);
	});

	it('WEB-ADM-08: loginAdmin uses credentials include and throws AdminApiError on 401', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ statusCode: 401, message: 'Invalid credentials' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(loginAdmin({ username: 'admin', password: 'wrong' })).rejects.toBeInstanceOf(
			AdminApiError,
		);

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/auth/login',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
			}),
		);
	});

	it('WEB-ADM-UNLOCK-01: unlockAdminUser POSTs to the unlock path with CSRF', async () => {
		setCsrfToken('csrf-1');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, id: 'a1' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(unlockAdminUser('a1')).resolves.toEqual({ ok: true, id: 'a1' });
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/admin-users/a1/unlock',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-1' }),
			}),
		);
	});

	it('WEB-ADM-UNLOCK-02: unlockIdentityUser POSTs to the identity unlock path', async () => {
		setCsrfToken('csrf-2');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, id: 'u1' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(unlockIdentityUser('u1')).resolves.toEqual({ ok: true, id: 'u1' });
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/identity/users/u1/unlock',
			expect.objectContaining({ method: 'POST', credentials: 'include' }),
		);
	});

	it('adminFetch returns parsed JSON on success', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ ok: true }),
			}),
		);

		await expect(adminFetch('/api/admin/auth/logout', { method: 'POST' })).resolves.toEqual({
			ok: true,
		});
	});

	it('WEB-ADM-13: adminFetch sends CSRF header on POST after login', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					ok: true,
					admin: { id: '1', username: 'admin' },
					csrfToken: 'stored-csrf-token',
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ ok: true }),
			});
		vi.stubGlobal('fetch', fetchMock);

		await loginAdmin({ username: 'admin', password: 'secret' });
		await logoutAdmin();

		expect(fetchMock).toHaveBeenLastCalledWith(
			'/api/admin/auth/logout',
			expect.objectContaining({
				credentials: 'include',
				method: 'POST',
				headers: expect.objectContaining({
					[ADMIN_CSRF_HEADER_NAME]: 'stored-csrf-token',
				}),
			}),
		);
	});

	it('WEB-ADM-14: CSRF token cleared on logout', async () => {
		setCsrfToken('before-logout');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await logoutAdmin();
		expect(getCsrfToken()).toBeNull();
	});

	it('WEB-ADM-16: AdminApiError exposes statusCode', async () => {
		const error = new AdminApiError(429, 'Too many login attempts');
		expect(error.statusCode).toBe(429);
		expect(error.message).toBe('Too many login attempts');
	});

	it('WEB-API-01: createApiConnection POSTs to API_CONNECTIONS_API_PATH with CSRF header', async () => {
		setCsrfToken('csrf-for-create');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ connection: { id: '1', name: 'Corp' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await createApiConnection({
			name: 'Corp',
			baseUrl: 'https://identity.example.com',
			bearerToken: 'secret',
		});

		expect(fetchMock).toHaveBeenCalledWith(
			API_CONNECTIONS_API_PATH,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					[ADMIN_CSRF_HEADER_NAME]: 'csrf-for-create',
				}),
			}),
		);
	});

	it('WEB-API-02: listApiConnections GET without CSRF', async () => {
		setCsrfToken('should-not-send-on-get');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connections: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await listApiConnections();

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers[ADMIN_CSRF_HEADER_NAME]).toBeUndefined();
	});

	it('WEB-API-03: testApiConnection POSTs to .../:id/test with CSRF header', async () => {
		setCsrfToken('csrf-for-test');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, reachable: true, message: 'ok' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await testApiConnection('conn-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`${API_CONNECTIONS_API_PATH}/conn-1/test`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					[ADMIN_CSRF_HEADER_NAME]: 'csrf-for-test',
				}),
			}),
		);
	});

	it('WEB-API-04: updateApiConnection PATCH with CSRF header', async () => {
		setCsrfToken('csrf-patch');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connection: { id: '1' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await updateApiConnection('conn-1', { name: 'Renamed' });

		expect(fetchMock).toHaveBeenCalledWith(
			`${API_CONNECTIONS_API_PATH}/conn-1`,
			expect.objectContaining({
				method: 'PATCH',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-patch' }),
			}),
		);
	});

	it('WEB-API-05: deleteApiConnection DELETE with CSRF header', async () => {
		setCsrfToken('csrf-delete');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, id: 'conn-1' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await deleteApiConnection('conn-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`${API_CONNECTIONS_API_PATH}/conn-1`,
			expect.objectContaining({
				method: 'DELETE',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-delete' }),
			}),
		);
	});

	it('WEB-API-06: getApiConnection GET without CSRF header', async () => {
		setCsrfToken('should-not-send');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connection: { id: '1' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await getApiConnection('conn-1');

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers[ADMIN_CSRF_HEADER_NAME]).toBeUndefined();
	});

	it('WEB-ADM-17: loginAdmin stores csrfToken from response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					ok: true,
					admin: { id: '1', username: 'admin' },
					csrfToken: 'login-csrf-token',
				}),
			}),
		);

		await loginAdmin({ username: 'admin', password: 'secret' });
		expect(getCsrfToken()).toBe('login-csrf-token');
	});

	it('WEB-ADM-102: loginAdmin JSON includes rememberMe when passed', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				ok: true,
				admin: { id: '1', username: 'admin' },
				csrfToken: 'csrf',
			}),
		});
		vi.stubGlobal('fetch', fetchMock);

		await loginAdmin({ username: 'admin', password: 'secret', rememberMe: true });

		const body = fetchMock.mock.calls[0][1]?.body as string;
		expect(JSON.parse(body)).toEqual({
			username: 'admin',
			password: 'secret',
			rememberMe: true,
		});
	});

	it('WEB-ADM-103: loginAdmin JSON includes rememberMe false when passed', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				ok: true,
				admin: { id: '1', username: 'admin' },
				csrfToken: 'csrf',
			}),
		});
		vi.stubGlobal('fetch', fetchMock);

		await loginAdmin({ username: 'admin', password: 'secret', rememberMe: false });

		const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
			rememberMe?: boolean;
		};
		expect(body.rememberMe).toBe(false);
	});

	it('WEB-ADM-104: loginAdmin without rememberMe omits field from JSON', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				ok: true,
				admin: { id: '1', username: 'admin' },
				csrfToken: 'csrf',
			}),
		});
		vi.stubGlobal('fetch', fetchMock);

		await loginAdmin({ username: 'admin', password: 'secret' });

		const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
		expect(body).not.toHaveProperty('rememberMe');
	});

	it('WEB-ADM-18: getAdminMe stores csrfToken from response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					admin: { id: '1', username: 'admin' },
					csrfToken: 'me-csrf-token',
				}),
			}),
		);

		await getAdminMe();
		expect(getCsrfToken()).toBe('me-csrf-token');
	});

	it('WEB-ADM-19: adminFetch does not attach CSRF on GET when token set', async () => {
		setCsrfToken('stored-token');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connections: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await adminFetch('/api/admin/api-connections');

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers[ADMIN_CSRF_HEADER_NAME]).toBeUndefined();
	});

	it('WEB-SYNC-01: triggerIdentitySync sends CSRF header', async () => {
		setCsrfToken('sync-csrf');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ syncLog: {}, connection: {} }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await triggerIdentitySync('conn-1');

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers[ADMIN_CSRF_HEADER_NAME]).toBe('sync-csrf');
	});

	it('WEB-SYNC-02: listSyncLogs builds query string', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ syncLogs: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await listSyncLogs('conn-1', 50);

		expect(fetchMock).toHaveBeenCalledWith(
			`${SYNC_API_PATH}/conn-1/logs?limit=50`,
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('WEB-SYNC-03: triggerIdentitySync dryRun sends body', async () => {
		setCsrfToken('sync-csrf');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ syncLog: {}, connection: {} }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await triggerIdentitySync('conn-1', { dryRun: true });

		expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ dryRun: true }));
	});

	it('WEB-SYNC-04: getSyncStatus hits status endpoint', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connectionId: 'conn-1', syncInProgress: false }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await getSyncStatus('conn-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`${SYNC_API_PATH}/conn-1/status`,
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('WEB-SYNC-05: getSyncLog hits log detail endpoint', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ syncLog: { id: 'log-1' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await getSyncLog('log-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`${SYNC_API_PATH}/logs/log-1`,
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('WEB-SYNC-06: triggerIdentitySync throws AdminApiError on 409', async () => {
		setCsrfToken('sync-csrf');
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 409,
				statusText: 'Conflict',
				json: async () => ({ statusCode: 409, message: 'Sync already in progress' }),
			}),
		);

		await expect(triggerIdentitySync('conn-1')).rejects.toMatchObject({
			name: 'AdminApiError',
			statusCode: 409,
			message: 'Sync already in progress',
		});
	});

	it('WEB-SYNC-07: listSyncLogs omits query when limit undefined', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ syncLogs: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await listSyncLogs('conn-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`${SYNC_API_PATH}/conn-1/logs`,
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('WEB-SYNC-08: getSyncStatus throws AdminApiError on 404', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				statusText: 'Not Found',
				json: async () => ({ statusCode: 404, message: 'API connection not found' }),
			}),
		);

		await expect(getSyncStatus('missing')).rejects.toMatchObject({
			name: 'AdminApiError',
			statusCode: 404,
		});
	});

	it('WEB-ADM-SAML-01: listSpConnections GETs admin SP path', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await listSpConnections();
		expect(fetchMock).toHaveBeenCalledWith(
			SP_CONNECTIONS_API_PATH,
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('WEB-ADM-SAML-02: getSpConnection GETs by id', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ id: 'sp-1', spEntityId: 'urn:sp' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getSpConnection('sp-1');
		expect(fetchMock).toHaveBeenCalledWith(`${SP_CONNECTIONS_API_PATH}/sp-1`, expect.any(Object));
	});

	it('WEB-ADM-SAML-03: getIdpMetadataUrl GETs metadata helper', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				metadataUrl: 'http://localhost:3000/saml/metadata',
				entityId: 'http://localhost:3000',
				ssoUrl: 'http://localhost:3000/saml/sso',
			}),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getIdpMetadataUrl();
		expect(fetchMock).toHaveBeenCalledWith(IDP_METADATA_URL_API_PATH, expect.any(Object));
	});

	it('WEB-ADM-24: getAdminDashboard GETs /api/admin', async () => {
		const { getAdminDashboard } = await import('@/admin/adminApi');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				counts: { users: 0, groups: 0, roles: 0, apiConnections: 0, spConnections: 0 },
			}),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getAdminDashboard();
		expect(fetchMock).toHaveBeenCalledWith('/api/admin', expect.any(Object));
	});

	it('WEB-ADM-25: createSpConnection POSTs with CSRF', async () => {
		const { createSpConnection, setCsrfToken } = await import('@/admin/adminApi');
		setCsrfToken('csrf-xyz');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ item: { id: 'sp-1' } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await createSpConnection({
			name: 'App',
			spEntityId: 'urn:sp:app',
			acsUrl: 'https://sp.example.com/acs',
		});
		expect(fetchMock).toHaveBeenCalledWith(
			SP_CONNECTIONS_API_PATH,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-xyz' }),
			}),
		);
	});

	it('WEB-ADM-100: listIdentityUsers defaults limit to 10', async () => {
		const { listIdentityUsers } = await import('@/admin/adminApi');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0 }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await listIdentityUsers();
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDENTITY_USERS_API_PATH}?limit=10`,
			expect.any(Object),
		);
	});

	it('WEB-ADM-101: listIdentityGroups and listIdentityRoles default limit to 10', async () => {
		const { listIdentityGroups, listIdentityRoles } = await import('@/admin/adminApi');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0 }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await listIdentityGroups();
		await listIdentityRoles();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/identity/groups?limit=10',
			expect.any(Object),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/identity/roles?limit=10',
			expect.any(Object),
		);
	});

	it('WEB-ADM-26: listIdentityUsers builds search query', async () => {
		const { listIdentityUsers } = await import('@/admin/adminApi');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0 }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await listIdentityUsers({ search: 'alice' });
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDENTITY_USERS_API_PATH}?limit=10&search=alice`,
			expect.any(Object),
		);
	});

	it('WEB-ADM-34: updateSpConnection PATCHes with CSRF', async () => {
		const { updateSpConnection, setCsrfToken } = await import('@/admin/adminApi');
		setCsrfToken('csrf-patch');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ item: { id: 'sp-1' } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await updateSpConnection('sp-1', { active: false });
		expect(fetchMock).toHaveBeenCalledWith(
			`${SP_CONNECTIONS_API_PATH}/sp-1`,
			expect.objectContaining({
				method: 'PATCH',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-patch' }),
			}),
		);
	});

	it('WEB-ADM-35: deleteSpConnection DELETEs with CSRF', async () => {
		const { deleteSpConnection, setCsrfToken } = await import('@/admin/adminApi');
		setCsrfToken('csrf-del');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, id: 'sp-1' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await deleteSpConnection('sp-1');
		expect(fetchMock).toHaveBeenCalledWith(
			`${SP_CONNECTIONS_API_PATH}/sp-1`,
			expect.objectContaining({ method: 'DELETE' }),
		);
	});

	it('WEB-ADM-36: testSpConnectionAcs POSTs test endpoint', async () => {
		const { testSpConnectionAcs, setCsrfToken } = await import('@/admin/adminApi');
		setCsrfToken('csrf-tacs');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, reachable: true, message: 'ok' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await testSpConnectionAcs('sp-1');
		expect(fetchMock).toHaveBeenCalledWith(
			`${SP_CONNECTIONS_API_PATH}/sp-1/test-acs`,
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('WEB-SP-TEST-SSO-API-01: getSpConnectionTestSsoUrl builds query string', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				ssoUrl: 'http://localhost:3000/saml/sso?SAMLRequest=test',
				spEntityId: 'urn:sp:1',
				authnRequestId: '_test-1',
				signed: true,
				encrypted: false,
			}),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getSpConnectionTestSsoUrl('sp-1', { signed: true, encrypted: false, relayState: 'abc' });
		expect(fetchMock).toHaveBeenCalledWith(
			`${SP_CONNECTIONS_API_PATH}/sp-1/test-sso-url?signed=true&encrypted=false&relayState=abc`,
			expect.any(Object),
		);
	});

	it('WEB-SP-PROBE-SIG-API-01: probeSpConnectionSigning POSTs key body', async () => {
		setCsrfToken('csrf-probe');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, fingerprintSha256: 'aa:bb' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await probeSpConnectionSigning('sp-1', {
			spPrivateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`${SP_CONNECTIONS_API_PATH}/sp-1/probe-sp-signing`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-probe' }),
			}),
		);
	});

	it('WEB-ADM-37: getIdentityUser GETs user detail path', async () => {
		const { getIdentityUser } = await import('@/admin/adminApi');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ user: { id: 'u1' }, groups: [], roles: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getIdentityUser('u1');
		expect(fetchMock).toHaveBeenCalledWith(`${IDENTITY_USERS_API_PATH}/u1`, expect.any(Object));
	});

	it('WEB-IDP-API-01: getIdpSettings GETs IDP_SETTINGS_API_PATH', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ entityId: 'http://localhost:3000' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getIdpSettings();
		expect(fetchMock).toHaveBeenCalledWith(IDP_SETTINGS_API_PATH, expect.any(Object));
	});

	it('WEB-IDP-API-02: updateIdpSettings PATCHes with CSRF', async () => {
		setCsrfToken('csrf-idp-patch');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ entityId: 'https://idp.example.com' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await updateIdpSettings({ entityId: 'https://idp.example.com' });
		expect(fetchMock).toHaveBeenCalledWith(
			IDP_SETTINGS_API_PATH,
			expect.objectContaining({
				method: 'PATCH',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-patch' }),
			}),
		);
	});

	it('WEB-IDP-API-05: generateIdpSigningCert serializes full crypto body', async () => {
		setCsrfToken('csrf-idp-gen-full');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ hasSigningCertificate: true }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await generateIdpSigningCert({
			keyFamily: 'ec',
			ecCurve: 'P-384',
			signatureAlgorithmId: 'ecdsa-sha384',
			notAfter: '2029-05-20',
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/signing-cert/generate`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					keyFamily: 'ec',
					ecCurve: 'P-384',
					signatureAlgorithmId: 'ecdsa-sha384',
					notAfter: '2029-05-20',
				}),
			}),
		);
	});

	it('WEB-IDP-API-03: generateIdpSigningCert POSTs generate endpoint with CSRF', async () => {
		setCsrfToken('csrf-idp-gen');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ hasSigningCertificate: true }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await generateIdpSigningCert({});
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/signing-cert/generate`,
			expect.objectContaining({
				method: 'POST',
				body: '{}',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-gen' }),
			}),
		);
	});

	it('WEB-IDP-API-04: uploadIdpSigningCert POSTs upload endpoint with CSRF', async () => {
		setCsrfToken('csrf-idp-upload');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ hasSigningCertificate: true }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await uploadIdpSigningCert({
			signingCertPem: 'cert',
			signingPrivateKeyPem: 'key',
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/signing-cert/upload`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-upload' }),
			}),
		);
	});

	it('WEB-IDP-API-05: startIdpCertRotation POSTs rotation start with CSRF', async () => {
		setCsrfToken('csrf-idp-rotate');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ rotation: { active: true } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await startIdpCertRotation({ mode: 'generate' });
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ mode: 'generate' }),
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-rotate' }),
			}),
		);
	});

	it('WEB-IDP-API-06: completeIdpCertRotation POSTs complete endpoint with CSRF', async () => {
		setCsrfToken('csrf-idp-complete');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ rotation: { active: false } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await completeIdpCertRotation();
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-complete' }),
			}),
		);
	});

	it('WEB-IDP-API-07: cancelIdpCertRotation POSTs cancel endpoint with CSRF', async () => {
		setCsrfToken('csrf-idp-cancel');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ rotation: { active: false } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await cancelIdpCertRotation();
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-cancel' }),
			}),
		);
	});

	it('WEB-IDP-ENC-API-01: generateIdpEncryptionCert POSTs encryption generate with CSRF', async () => {
		setCsrfToken('csrf-idp-enc-gen');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ hasEncryptionCertificate: true }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await generateIdpEncryptionCert({
			keyFamily: 'rsa',
			rsaModulusBits: 3072,
			keyTransportAlgorithmId: 'rsa-oaep',
			notAfter: '2029-01-01',
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					keyFamily: 'rsa',
					rsaModulusBits: 3072,
					keyTransportAlgorithmId: 'rsa-oaep',
					notAfter: '2029-01-01',
				}),
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-enc-gen' }),
			}),
		);
	});

	it('WEB-IDP-ENC-API-02: getIdpEncryptionCertPublicPem GETs public-pem path', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ certPem: '-----BEGIN CERTIFICATE-----' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getIdpEncryptionCertPublicPem();
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/encryption-cert/public-pem`,
			expect.any(Object),
		);
	});

	it('WEB-IDP-ENC-API-03: startIdpEncryptionCertRotation POSTs encryption rotation start', async () => {
		setCsrfToken('csrf-idp-enc-rot');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ encryptionRotation: { active: true } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await startIdpEncryptionCertRotation({ mode: 'generate', keyFamily: 'rsa' });
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ mode: 'generate', keyFamily: 'rsa' }),
			}),
		);
	});

	it('WEB-IDP-ENC-API-04: completeIdpEncryptionCertRotation POSTs encryption rotation complete', async () => {
		setCsrfToken('csrf-idp-enc-complete');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ encryptionRotation: { active: false } }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await completeIdpEncryptionCertRotation();
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/complete`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-idp-enc-complete' }),
			}),
		);
	});

	it('WEB-IDP-ENC-API-05: cancelIdpEncryptionCertRotation and uploadIdpEncryptionCert POST correct paths', async () => {
		setCsrfToken('csrf-idp-enc-more');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({}),
		});
		vi.stubGlobal('fetch', fetchMock);
		await cancelIdpEncryptionCertRotation();
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`,
			expect.objectContaining({ method: 'POST' }),
		);
		await uploadIdpEncryptionCert({
			encryptionCertPem: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
			encryptionPrivateKeyPem: '-----BEGIN PRIVATE KEY-----\nK\n-----END PRIVATE KEY-----',
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`,
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('WEB-IDP-API-08: getIdpMetadataPreview GETs metadata-preview path', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ xml: '<EntityDescriptor/>', contentType: 'application/xml' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await getIdpMetadataPreview();
		expect(fetchMock).toHaveBeenCalledWith(
			`${IDP_SETTINGS_API_PATH}/metadata-preview`,
			expect.any(Object),
		);
	});

	it('WEB-ADM-77: listAdminUsers GETs admin-users API', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => [{ id: 'a1', username: 'admin', createdAt: '', updatedAt: '' }],
		});
		vi.stubGlobal('fetch', fetchMock);
		await listAdminUsers();
		expect(fetchMock).toHaveBeenCalledWith(ADMIN_USERS_API_PATH, expect.any(Object));
	});

	it('WEB-ADM-78: createAdminUser POSTs with CSRF header', async () => {
		setCsrfToken('csrf-create-admin');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ id: 'a2', username: 'ops', createdAt: '', updatedAt: '' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await createAdminUser({ username: 'ops', password: 'OpsPass123456' });
		expect(fetchMock).toHaveBeenCalledWith(
			ADMIN_USERS_API_PATH,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-create-admin' }),
			}),
		);
	});

	it('WEB-ADM-79: deleteAdminUser DELETEs with CSRF', async () => {
		setCsrfToken('csrf-del');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, id: 'a2' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await deleteAdminUser('a2');
		expect(fetchMock).toHaveBeenCalledWith(
			`${ADMIN_USERS_API_PATH}/a2`,
			expect.objectContaining({
				method: 'DELETE',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-del' }),
			}),
		);
	});

	it('WEB-ADM-80: changeAdminPassword POSTs change-password endpoint', async () => {
		setCsrfToken('csrf-pwd');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await changeAdminPassword({ currentPassword: 'old', newPassword: 'new' });
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/auth/change-password',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('WEB-ADM-96: auditExportUrl builds export path with format query', () => {
		expect(auditExportUrl({ format: 'csv', category: 'admin_auth' })).toBe(
			`${AUDIT_EVENTS_API_PATH}/export?format=csv&category=admin_auth`,
		);
	});

	it('WEB-ADM-97: listAuditEvents appends query string', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await listAuditEvents({ limit: '10', category: 'sync' });
		expect(fetchMock).toHaveBeenCalledWith(
			`${AUDIT_EVENTS_API_PATH}?limit=10&category=sync`,
			expect.any(Object),
		);
	});

	it('WEB-ADM-98: auditExportUrl does not include CSRF (GET-only)', () => {
		const url = auditExportUrl({ format: 'json' });
		expect(url).toContain('/export?');
		expect(url).not.toContain('csrf');
	});

	it('WEB-ADM-99: updateAdminUser PATCHes password with CSRF', async () => {
		setCsrfToken('csrf-patch');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ id: 'a2', username: 'ops', createdAt: '', updatedAt: '' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await updateAdminUser('a2', { password: 'NewOpsPass123' });
		expect(fetchMock).toHaveBeenCalledWith(
			`${ADMIN_USERS_API_PATH}/a2`,
			expect.objectContaining({
				method: 'PATCH',
				body: JSON.stringify({ password: 'NewOpsPass123' }),
			}),
		);
	});
});
