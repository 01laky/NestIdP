import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveApiContract, type ApiContractConfig } from '@nestidp/shared';
import {
	DEFAULT_SYNC_HTTP_TIMEOUT_MS,
	DEFAULT_SYNC_MAX_USERS_PER_RUN,
	IdentitySyncClientService,
} from '@api/sync/services/identity-sync-client.service';
import { IdentitySyncHttpError } from '@api/sync/identity-sync.errors';
import { ExternalApiValidationError } from '@api/sync/validators/external-api.validator';

const TEST_PASSWORD_HASH = '$2b$12$test.hash.for.integration.tests.only';
const BEARER_TOKEN = 'plain-bearer-token-for-sync-tests';
const BASE = 'https://identity.example.com';
const C = (cfg?: ApiContractConfig | null) => resolveApiContract(cfg ?? null);

function jsonResponse(body: unknown, status = 200): Response {
	return { status, json: async () => body } as Response;
}

describe('IdentitySyncClientService', () => {
	const configService = {
		get: jest.fn(() => undefined),
	} as unknown as ConfigService;
	const service = new IdentitySyncClientService(configService);

	beforeEach(() => jest.clearAllMocks());

	it('API-SYNC-HTTP-01: fetchUsersRaw sends Bearer header', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([]));
		await service.fetchUsersRaw(BASE, BEARER_TOKEN, C());
		expect(fetchMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({
					Authorization: `Bearer ${BEARER_TOKEN}`,
					Accept: 'application/json',
				}),
			}),
		);
	});

	it('API-SYNC-CONTRACT-01: default contract builds /users, /users/:id/groups, /users/:id/roles', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([]));
		await service.fetchUsersRaw(`${BASE}/`, BEARER_TOKEN, C());
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/users`, expect.any(Object));
		await service.fetchGroupsRawForUser(BASE, BEARER_TOKEN, 'u1', C());
		expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/users/u1/groups`, expect.any(Object));
		await service.fetchRolesRawForUser(BASE, BEARER_TOKEN, 'u1', C());
		expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/users/u1/roles`, expect.any(Object));
	});

	it('API-SYNC-CONTRACT-02: custom paths used; :id substituted + URL-encoded', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([]));
		const contract = C({
			endpoints: {
				usersPath: '/v1/accounts',
				userGroupsPath: '/v1/accounts/:id/memberships',
				userRolesPath: '/v1/accounts/:id/roles',
			},
		});
		await service.fetchUsersRaw(BASE, BEARER_TOKEN, contract);
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/v1/accounts`, expect.any(Object));
		await service.fetchGroupsRawForUser(BASE, BEARER_TOKEN, 'user/with spaces', contract);
		expect(fetchMock).toHaveBeenLastCalledWith(
			`${BASE}/v1/accounts/user%2Fwith%20spaces/memberships`,
			expect.any(Object),
		);
	});

	it('API-SYNC-CONTRACT-03: queryParams appended to the request URL', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([]));
		await service.fetchUsersRaw(BASE, BEARER_TOKEN, C({ queryParams: { include: 'all', v: '2' } }));
		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain('include=all');
		expect(url).toContain('v=2');
	});

	it('API-SYNC-CONTRACT-04: responseRoot extracts the array from { data: [...] }', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ data: [{ id: 'u1' }, { id: 'u2' }] }));
		const rows = await service.fetchUsersRaw(
			BASE,
			BEARER_TOKEN,
			C({ responseRoot: { users: 'data' } }),
		);
		expect(rows).toHaveLength(2);
	});

	it('API-SYNC-CONTRACT-05: resolved URL whose origin ≠ base origin is rejected', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([]));
		// A path that resolves off-origin would be blocked; simulate via a crafted path the
		// validator would normally reject, proving the client re-check throws.
		const contract = C();
		contract.endpoints.usersPath = '//evil.example/users';
		await expect(service.fetchUsersRaw(BASE, BEARER_TOKEN, contract)).rejects.toBeInstanceOf(
			IdentitySyncHttpError,
		);
	});

	it('API-SYNC-CONTRACT-E2-01: offset pagination follows pages until a short page', async () => {
		const page0 = Array.from({ length: 2 }, (_, i) => ({ id: `a${i}` }));
		const page1 = [{ id: 'b0' }]; // short page → stop
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse(page0))
			.mockResolvedValueOnce(jsonResponse(page1));
		const rows = await service.fetchUsersRaw(
			BASE,
			BEARER_TOKEN,
			C({
				pagination: {
					mode: 'offset',
					offsetParam: 'offset',
					limitParam: 'limit',
					pageSize: 2,
					maxPages: 10,
				},
			}),
		);
		expect(rows).toHaveLength(3);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][0]).toContain('offset=2');
	});

	it('API-SYNC-CONTRACT-E2-02: page pagination stops at maxPages', async () => {
		const fullPage = [{ id: 'x' }, { id: 'y' }];
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(fullPage));
		const rows = await service.fetchUsersRaw(
			BASE,
			BEARER_TOKEN,
			C({
				pagination: {
					mode: 'page',
					pageParam: 'page',
					limitParam: 'per_page',
					pageSize: 2,
					startPage: 1,
					maxPages: 3,
				},
			}),
		);
		// Without dedup at the client level, 3 full pages × 2 = 6 rows.
		expect(rows).toHaveLength(6);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('API-CONTRACT-E3-01: extra headers are sent', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([]));
		await service.fetchUsersRaw(BASE, BEARER_TOKEN, C({ headers: { 'X-Api-Version': '2' } }));
		expect(fetchMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Version': '2' }) }),
		);
	});

	it('API-SYNC-HTTP-03: Non-2xx throws with statusCode', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 503));
		await expect(service.fetchUsersRaw(BASE, BEARER_TOKEN, C())).rejects.toMatchObject({
			name: 'IdentitySyncHttpError',
			message: 'Identity API returned HTTP 503',
			options: expect.objectContaining({ statusCode: 503, reachable: true }),
		});
	});

	it('API-SYNC-HTTP-04: Timeout → reachable false', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockRejectedValue(Object.assign(new Error('Timeout'), { name: 'TimeoutError' }));
		await expect(service.fetchUsersRaw(BASE, BEARER_TOKEN, C())).rejects.toMatchObject({
			name: 'IdentitySyncHttpError',
			message: 'Identity API request timed out',
			options: expect.objectContaining({ reachable: false }),
		});
	});

	it('API-SYNC-HTTP-06: Never logs token', async () => {
		const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
		await expect(service.fetchUsersRaw(BASE, BEARER_TOKEN, C())).rejects.toBeInstanceOf(
			IdentitySyncHttpError,
		);
		for (const call of [...logSpy.mock.calls, ...warnSpy.mock.calls]) {
			expect(call.join(' ')).not.toContain(BEARER_TOKEN);
		}
		logSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('non-array response throws ExternalApiValidationError', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ data: [] }));
		await expect(service.fetchUsersRaw(BASE, BEARER_TOKEN, C())).rejects.toBeInstanceOf(
			ExternalApiValidationError,
		);
	});

	it('responseRoot path missing → clear error naming the path', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ other: [] }));
		await expect(
			service.fetchUsersRaw(BASE, BEARER_TOKEN, C({ responseRoot: { users: 'data' } })),
		).rejects.toThrow(/data/);
	});

	it('uses default config values', () => {
		expect(service.getHttpTimeoutMs()).toBe(DEFAULT_SYNC_HTTP_TIMEOUT_MS);
		expect(service.getMaxUsersPerRun()).toBe(DEFAULT_SYNC_MAX_USERS_PER_RUN);
	});

	it('API-CONTRACT-E10: membership caps from contract override env', () => {
		expect(service.getMaxGroupsPerUser(C({ maxGroupsPerUser: 7 }))).toBe(7);
		expect(service.getMaxRolesPerUser(C({ maxRolesPerUser: 9 }))).toBe(9);
		expect(service.getMembershipFetchConcurrency()).toBe(5);
	});

	it('custom SYNC_HTTP_TIMEOUT_MS from config', () => {
		const custom = new IdentitySyncClientService({
			get: jest.fn((k: string) => (k === 'SYNC_HTTP_TIMEOUT_MS' ? '15000' : undefined)),
		} as unknown as ConfigService);
		expect(custom.getHttpTimeoutMs()).toBe(15_000);
	});

	it('EDGE: pagination stops + truncates at SYNC_MAX_USERS_PER_RUN', async () => {
		const capped = new IdentitySyncClientService({
			get: jest.fn((k: string) => (k === 'SYNC_MAX_USERS_PER_RUN' ? '3' : undefined)),
		} as unknown as ConfigService);
		jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([{ id: 'a' }, { id: 'b' }]));
		const rows = await capped.fetchUsersRaw(
			BASE,
			BEARER_TOKEN,
			C({
				pagination: {
					mode: 'offset',
					offsetParam: 'o',
					limitParam: 'l',
					pageSize: 2,
					maxPages: 100,
				},
			}),
		);
		expect(rows).toHaveLength(3); // capped at 3 even though pages keep returning 2
	});

	it('EDGE: empty first page → zero rows, single request', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([]));
		const rows = await service.fetchUsersRaw(
			BASE,
			BEARER_TOKEN,
			C({ pagination: { mode: 'offset', offsetParam: 'o', pageSize: 50, maxPages: 5 } }),
		);
		expect(rows).toHaveLength(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('EDGE: responseRoot envelope applied per page during pagination', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'a' }, { id: 'b' }] }))
			.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'c' }] }));
		const rows = await service.fetchUsersRaw(
			BASE,
			BEARER_TOKEN,
			C({
				responseRoot: { users: 'data' },
				pagination: {
					mode: 'page',
					pageParam: 'page',
					limitParam: 'size',
					pageSize: 2,
					maxPages: 5,
				},
			}),
		);
		expect(rows.map((r) => (r as { id: string }).id)).toEqual(['a', 'b', 'c']);
	});

	it('EDGE: group raw fetch uses custom path + responseRoot', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(jsonResponse({ memberships: [{ id: 'g1', name: 'Eng' }] }));
		const rows = await service.fetchGroupsRawForUser(
			BASE,
			BEARER_TOKEN,
			'u1',
			C({
				endpoints: { userGroupsPath: '/accounts/:id/memberships' },
				responseRoot: { groups: 'memberships' },
			}),
		);
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/accounts/u1/memberships`, expect.any(Object));
		expect(rows).toHaveLength(1);
	});

	it('API-CONTRACT-E10-01: maxGroupsPerUser caps the group raw fetch', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(
				jsonResponse(Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, name: `G${i}` }))),
			);
		const rows = await service.fetchGroupsRawForUser(
			BASE,
			BEARER_TOKEN,
			'u1',
			C({
				maxGroupsPerUser: 4,
				pagination: { mode: 'offset', offsetParam: 'o', pageSize: 10, maxPages: 5 },
			}),
		);
		expect(rows).toHaveLength(4);
	});
});
