import type { ApiConnection, PrismaClient } from '@prisma/client';
import { LOCAL_DIRECTORY_BASE_URL, LOCAL_DIRECTORY_CONNECTION_NAME } from '@nestidp/shared';
import {
	ensureLocalDirectoryConnection,
	manualExternalId,
	toOriginLiteral,
} from '@api/identity/utils/local-directory.util';

/**
 * Edge-case coverage for the local-directory helpers (manual identity store). `manualExternalId` and
 * `toOriginLiteral` are pure; `ensureLocalDirectoryConnection` is a find-or-create that must be idempotent
 * (never create a second local-directory row) and must encrypt the placeholder credential.
 */
describe('manualExternalId', () => {
	it('API-LOCALDIR-01: composes the manual:<kind>:<id> external id for each kind', () => {
		expect(manualExternalId('user', 'u1')).toBe('manual:user:u1');
		expect(manualExternalId('group', 'g1')).toBe('manual:group:g1');
		expect(manualExternalId('role', 'r1')).toBe('manual:role:r1');
	});

	it('API-LOCALDIR-02: passes the record id through verbatim (empty, colons, unicode)', () => {
		expect(manualExternalId('user', '')).toBe('manual:user:');
		expect(manualExternalId('user', 'a:b:c')).toBe('manual:user:a:b:c');
		expect(manualExternalId('group', 'náž 🔐')).toBe('manual:group:náž 🔐');
	});
});

describe('toOriginLiteral', () => {
	it('API-LOCALDIR-03: maps the Prisma enum to its lowercase wire literal', () => {
		expect(toOriginLiteral('MANUAL')).toBe('manual');
		expect(toOriginLiteral('SYNCED')).toBe('synced');
	});
});

describe('ensureLocalDirectoryConnection', () => {
	const encrypt = (plaintext: string) => `enc(${plaintext})`;

	function prismaMock(existing: ApiConnection | null) {
		const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
			id: 'new-id',
			...data,
		}));
		const findFirst = jest.fn(async () => existing);
		return {
			prisma: { apiConnection: { findFirst, create } } as unknown as PrismaClient,
			findFirst,
			create,
		};
	}

	it('API-LOCALDIR-04: returns the existing local-directory connection without creating one', async () => {
		const existing = { id: 'local-1', isLocalDirectory: true } as ApiConnection;
		const { prisma, findFirst, create } = prismaMock(existing);
		const result = await ensureLocalDirectoryConnection(prisma, encrypt);
		expect(result).toBe(existing);
		expect(findFirst).toHaveBeenCalledWith({ where: { isLocalDirectory: true } });
		expect(create).not.toHaveBeenCalled();
	});

	it('API-LOCALDIR-05: creates the connection with the shared name/base-url and encrypted credential', async () => {
		const { prisma, create } = prismaMock(null);
		const result = await ensureLocalDirectoryConnection(prisma, encrypt);
		expect(create).toHaveBeenCalledTimes(1);
		const data = create.mock.calls[0][0].data as Record<string, unknown>;
		expect(data).toMatchObject({
			name: LOCAL_DIRECTORY_CONNECTION_NAME,
			baseUrl: LOCAL_DIRECTORY_BASE_URL,
			authType: 'BEARER',
			isLocalDirectory: true,
		});
		// The placeholder credential is never stored in plaintext.
		expect(data.authCredentialsEncrypted).toBe('enc(local-directory-not-used)');
		expect(String(data.authCredentialsEncrypted)).not.toBe('local-directory-not-used');
		expect((result as { isLocalDirectory: boolean }).isLocalDirectory).toBe(true);
	});
});
