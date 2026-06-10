import {
	getCachedIdpSettings,
	invalidateIdpSettingsCache,
} from '@api/idp-settings/utils/idp-settings-cache.util';

function makePrisma(rows: Array<Record<string, unknown> | null>) {
	let calls = 0;
	const prisma = {
		idpSettings: {
			findUnique: jest.fn(async () => rows[Math.min(calls++, rows.length - 1)]),
		},
	};
	return { prisma: prisma as never, findUnique: prisma.idpSettings.findUnique };
}

describe('idp-settings cache (§A5 / Prompt 38 §7, SETTINGS-CACHE)', () => {
	it('SETTINGS-CACHE-01: within the TTL the row is served from cache (one DB read)', async () => {
		const { prisma, findUnique } = makePrisma([{ id: 'default', entityId: 'a' }]);
		const a = await getCachedIdpSettings(prisma, { ttlMs: 5000, now: 1000 });
		const b = await getCachedIdpSettings(prisma, { ttlMs: 5000, now: 4000 });
		expect(a).toBe(b);
		expect(findUnique).toHaveBeenCalledTimes(1);
	});

	it('SETTINGS-CACHE-02: past the TTL the row is re-read', async () => {
		const { prisma, findUnique } = makePrisma([
			{ id: 'default', entityId: 'a' },
			{ id: 'default', entityId: 'b' },
		]);
		await getCachedIdpSettings(prisma, { ttlMs: 5000, now: 1000 });
		const fresh = await getCachedIdpSettings(prisma, { ttlMs: 5000, now: 6001 });
		expect(findUnique).toHaveBeenCalledTimes(2);
		expect((fresh as { entityId: string }).entityId).toBe('b');
	});

	it('SETTINGS-CACHE-03: invalidate forces the next read to hit the DB', async () => {
		const { prisma, findUnique } = makePrisma([
			{ id: 'default', entityId: 'a' },
			{ id: 'default', entityId: 'b' },
		]);
		await getCachedIdpSettings(prisma, { ttlMs: 5000, now: 1000 });
		invalidateIdpSettingsCache(prisma);
		const fresh = await getCachedIdpSettings(prisma, { ttlMs: 5000, now: 2000 });
		expect(findUnique).toHaveBeenCalledTimes(2);
		expect((fresh as { entityId: string }).entityId).toBe('b');
	});

	it('SETTINGS-CACHE-04: ttl 0 disables caching entirely (test-env default)', async () => {
		const { prisma, findUnique } = makePrisma([{ id: 'default' }]);
		await getCachedIdpSettings(prisma, { ttlMs: 0 });
		await getCachedIdpSettings(prisma, { ttlMs: 0 });
		expect(findUnique).toHaveBeenCalledTimes(2);
		// and the suite-wide default under NODE_ENV=test is disabled too
		await getCachedIdpSettings(prisma);
		await getCachedIdpSettings(prisma);
		expect(findUnique).toHaveBeenCalledTimes(4);
	});

	it('SETTINGS-CACHE-05: caches are isolated per Prisma instance', async () => {
		const one = makePrisma([{ id: 'default', entityId: 'one' }]);
		const two = makePrisma([{ id: 'default', entityId: 'two' }]);
		const a = await getCachedIdpSettings(one.prisma, { ttlMs: 5000, now: 1000 });
		const b = await getCachedIdpSettings(two.prisma, { ttlMs: 5000, now: 1000 });
		expect((a as { entityId: string }).entityId).toBe('one');
		expect((b as { entityId: string }).entityId).toBe('two');
	});

	it('SETTINGS-CACHE-06: a null row (settings not configured) is cached too', async () => {
		const { prisma, findUnique } = makePrisma([null]);
		await expect(getCachedIdpSettings(prisma, { ttlMs: 5000, now: 1000 })).resolves.toBeNull();
		await expect(getCachedIdpSettings(prisma, { ttlMs: 5000, now: 2000 })).resolves.toBeNull();
		expect(findUnique).toHaveBeenCalledTimes(1);
	});
});
