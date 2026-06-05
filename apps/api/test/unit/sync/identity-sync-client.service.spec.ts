import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	DEFAULT_SYNC_HTTP_TIMEOUT_MS,
	DEFAULT_SYNC_MAX_USERS_PER_RUN,
	IdentitySyncClientService,
} from '@api/sync/services/identity-sync-client.service';
import { IdentitySyncHttpError } from '@api/sync/identity-sync.errors';

const TEST_PASSWORD_HASH = '$2b$12$test.hash.for.integration.tests.only';
const BEARER_TOKEN = 'plain-bearer-token-for-sync-tests';

describe('IdentitySyncClientService', () => {
	const configService = {
		get: jest.fn((key: string) => {
			if (key === 'SYNC_HTTP_TIMEOUT_MS') return undefined;
			if (key === 'SYNC_MAX_USERS_PER_RUN') return undefined;
			if (key === 'SYNC_STALE_RUN_MINUTES') return undefined;
			return undefined;
		}),
	} as unknown as ConfigService;

	const service = new IdentitySyncClientService(configService);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-SYNC-HTTP-01: fetchUsers sends Bearer header', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [
				{
					id: 'u1',
					username: 'alice',
					passwordHash: TEST_PASSWORD_HASH,
					passwordHashAlgorithm: 'bcrypt',
					active: true,
				},
			],
		} as Response);

		await service.fetchUsers('https://identity.example.com', BEARER_TOKEN);

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

	it('API-SYNC-HTTP-02: URL joins baseUrl + /users (normalized)', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [],
		} as Response);

		await service.fetchUsers('https://identity.example.com/', BEARER_TOKEN);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://identity.example.com/users',
			expect.any(Object),
		);
	});

	it('API-SYNC-HTTP-03: Non-2xx throws with statusCode', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 503,
			json: async () => ({}),
		} as Response);

		await expect(
			service.fetchUsers('https://identity.example.com', BEARER_TOKEN),
		).rejects.toMatchObject({
			name: 'IdentitySyncHttpError',
			message: 'Identity API returned HTTP 503',
			options: expect.objectContaining({ statusCode: 503, reachable: true }),
		});
	});

	it('API-SYNC-HTTP-04: Timeout → reachable false', async () => {
		const timeoutError = Object.assign(new Error('Timeout'), { name: 'TimeoutError' });
		jest.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

		await expect(
			service.fetchUsers('https://identity.example.com', BEARER_TOKEN),
		).rejects.toMatchObject({
			name: 'IdentitySyncHttpError',
			message: 'Identity API request timed out',
			options: expect.objectContaining({ reachable: false }),
		});
	});

	it('API-SYNC-HTTP-05: Groups URL encodes external user id', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [{ id: 'g1', name: 'Engineering' }],
		} as Response);

		await service.fetchGroupsForUser(
			'https://identity.example.com',
			BEARER_TOKEN,
			'user/with spaces',
		);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://identity.example.com/users/user%2Fwith%20spaces/groups',
			expect.any(Object),
		);
	});

	it('API-SYNC-HTTP-06: Never logs token (spy Logger)', async () => {
		const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

		await expect(
			service.fetchUsers('https://identity.example.com', BEARER_TOKEN),
		).rejects.toBeInstanceOf(IdentitySyncHttpError);

		for (const call of [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]) {
			expect(call.join(' ')).not.toContain(BEARER_TOKEN);
		}
		for (const call of consoleSpy.mock.calls) {
			expect(call.join(' ')).not.toContain(BEARER_TOKEN);
		}

		logSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
		consoleSpy.mockRestore();
	});

	it('uses default config values when env vars invalid', () => {
		expect(service.getHttpTimeoutMs()).toBe(DEFAULT_SYNC_HTTP_TIMEOUT_MS);
		expect(service.getMaxUsersPerRun()).toBe(DEFAULT_SYNC_MAX_USERS_PER_RUN);
	});

	it('maps ExternalApiValidationError to IdentitySyncHttpError on invalid users JSON', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => ({ data: [] }),
		} as Response);

		await expect(
			service.fetchUsers('https://identity.example.com', BEARER_TOKEN),
		).rejects.toMatchObject({
			name: 'IdentitySyncHttpError',
			message: 'Users response must be a JSON array',
		});
	});

	it('API-SYNC-HTTP-07: Roles URL encodes external user id', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [{ id: 'r1', name: 'Admin' }],
		} as Response);

		await service.fetchRolesForUser(
			'https://identity.example.com',
			BEARER_TOKEN,
			'user/with spaces',
		);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://identity.example.com/users/user%2Fwith%20spaces/roles',
			expect.any(Object),
		);
	});

	it('API-SYNC-HTTP-08: Invalid groups JSON array → IdentitySyncHttpError', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => ({ groups: [] }),
		} as Response);

		await expect(
			service.fetchGroupsForUser('https://identity.example.com', BEARER_TOKEN, 'u1'),
		).rejects.toMatchObject({
			name: 'IdentitySyncHttpError',
			message: 'Groups response must be a JSON array',
		});
	});

	it('API-SYNC-HTTP-09: Generic network error → reachable false', async () => {
		jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		await expect(
			service.fetchUsers('https://identity.example.com', BEARER_TOKEN),
		).rejects.toMatchObject({
			name: 'IdentitySyncHttpError',
			options: expect.objectContaining({ reachable: false }),
		});
	});

	it('API-SYNC-HTTP-10: fetchUsersRaw returns parsed users without groups/roles', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			status: 200,
			json: async () => [
				{
					id: 'u1',
					username: 'alice',
					passwordHash: TEST_PASSWORD_HASH,
					passwordHashAlgorithm: 'bcrypt',
					active: true,
				},
			],
		} as Response);

		const users = await service.fetchUsersRaw('https://identity.example.com', BEARER_TOKEN);
		expect(users).toEqual([expect.objectContaining({ id: 'u1', username: 'alice', active: true })]);
	});

	it('API-SYNC-HTTP-11: Custom SYNC_HTTP_TIMEOUT_MS from config', () => {
		const customConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SYNC_HTTP_TIMEOUT_MS') return '15000';
				return undefined;
			}),
		} as unknown as ConfigService;
		const customService = new IdentitySyncClientService(customConfig);
		expect(customService.getHttpTimeoutMs()).toBe(15_000);
	});

	it('API-SYNC-HTTP-12: Invalid SYNC_MAX_USERS_PER_RUN falls back to default', () => {
		const customConfig = {
			get: jest.fn((key: string) => {
				if (key === 'SYNC_MAX_USERS_PER_RUN') return 'not-a-number';
				return undefined;
			}),
		} as unknown as ConfigService;
		const customService = new IdentitySyncClientService(customConfig);
		expect(customService.getMaxUsersPerRun()).toBe(DEFAULT_SYNC_MAX_USERS_PER_RUN);
	});
});
