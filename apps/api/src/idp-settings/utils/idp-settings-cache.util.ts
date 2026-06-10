import type { IdpSettings } from '@prisma/client';
import { boundedInt } from '../../common/config/bounded-int.util';

/**
 * §A5 / Prompt 38 §7: the singleton IdP settings row is re-read on every SAML/auth request
 * (~21 call sites). This memoises the read per Prisma instance with a short TTL plus explicit
 * invalidation at every write site, cutting the per-request DB round-trips on the hot paths.
 *
 * Design notes:
 * - Keyed by the Prisma instance (WeakMap), so test databases / mocked clients are isolated and
 *   the cache dies with the client.
 * - TTL defaults to 5s in production and **0 (disabled) inside jest workers** (detected via
 *   JEST_WORKER_ID — NODE_ENV is not reliably 'test' under the monorepo runner) — integration
 *   suites freely write the row via raw fixtures and must never observe a stale read. Override
 *   with IDP_SETTINGS_CACHE_TTL_MS (0 disables; bounded at 5 minutes).
 * - Read-modify-write paths (idp-settings.service, the ensureSigningMaterial claim) deliberately
 *   keep DIRECT reads — only read-only consumers go through the cache.
 * - Single-instance deployment assumption (same as the schedulers): invalidation is in-process.
 */

interface PrismaWithIdpSettings {
	idpSettings: {
		findUnique(args: { where: { id: string } }): Promise<IdpSettings | null>;
	};
}

interface CacheEntry {
	row: IdpSettings | null;
	expiresAt: number;
}

const cache = new WeakMap<object, CacheEntry>();

function defaultTtlMs(): number {
	return boundedInt(
		process.env.IDP_SETTINGS_CACHE_TTL_MS,
		process.env.JEST_WORKER_ID !== undefined ? 0 : 5000,
		0,
		300_000,
	);
}

export async function getCachedIdpSettings(
	prisma: PrismaWithIdpSettings,
	opts?: { ttlMs?: number; now?: number },
): Promise<IdpSettings | null> {
	const ttlMs = opts?.ttlMs ?? defaultTtlMs();
	const now = opts?.now ?? Date.now();
	if (ttlMs <= 0) {
		return prisma.idpSettings.findUnique({ where: { id: 'default' } });
	}
	const entry = cache.get(prisma);
	if (entry && now < entry.expiresAt) {
		return entry.row;
	}
	const row = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
	cache.set(prisma, { row, expiresAt: now + ttlMs });
	return row;
}

/** Call after ANY write to the IdpSettings row so the next read is fresh. */
export function invalidateIdpSettingsCache(prisma: object): void {
	cache.delete(prisma);
}
