/**
 * Per-connection outbound HTTP proxy helpers (Prompt 33).
 *
 * Pure, dependency-free validation + no-proxy matching shared by the API (request validation,
 * dispatcher resolution) and the web admin (inline validation, effective-routing preview). No secret
 * ever lives here — the proxy password is encrypted at rest server-side and never reaches the client.
 */

/** Thrown by {@link validateProxyUrl} / no-proxy parsing; mapped to HTTP 400 by the API. */
export class ProxyConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProxyConfigError';
	}
}

/**
 * Outcome of a proxy reachability probe / the proxy hop classification. `bypassed` means the proxy
 * was off or the target matched `noProxyHosts` (a no-op, not a failure).
 */
export const PROXY_CHECK_STATUSES = [
	'ok',
	'auth_failed',
	'unreachable',
	'tunnel_failed',
	'tls_error',
	'target_error',
	'bypassed',
] as const;
export type ProxyCheckStatus = (typeof PROXY_CHECK_STATUSES)[number];

export function isProxyCheckStatus(value: string): value is ProxyCheckStatus {
	return (PROXY_CHECK_STATUSES as readonly string[]).includes(value);
}

/**
 * Validate + normalize a proxy URL. Must be an absolute `http:`/`https:` URL with no inline
 * credentials (proxy auth goes in the separate `proxyUsername`/`proxyPassword` fields so the password
 * is encrypted at rest). Mirrors `apps/api` base-url.util's credential rejection. Returns the
 * normalized URL string (lowercased host, no trailing junk). Throws {@link ProxyConfigError}.
 */
export function validateProxyUrl(raw: string): string {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) {
		throw new ProxyConfigError('Proxy URL must not be empty');
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new ProxyConfigError('Proxy URL is not a valid absolute URL');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new ProxyConfigError('Proxy URL must use http:// or https://');
	}
	if (parsed.username || parsed.password) {
		throw new ProxyConfigError(
			'Proxy URL must not embed credentials — use the proxy username/password fields',
		);
	}
	if (!parsed.hostname) {
		throw new ProxyConfigError('Proxy URL must include a host');
	}
	if (parsed.search || parsed.hash) {
		throw new ProxyConfigError('Proxy URL must not contain a query or fragment');
	}
	parsed.hostname = parsed.hostname.toLowerCase();
	// URL serializes a bare-host proxy with exactly one trailing slash — strip it once.
	let normalized = parsed.toString();
	if (normalized.endsWith('/') && parsed.pathname === '/') {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}

/** Split a comma/whitespace-separated no-proxy list into trimmed, lowercased, de-duplicated tokens. */
export function parseNoProxyHosts(raw: string | null | undefined): string[] {
	if (!raw) {
		return [];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(/[,\s]+/)) {
		const token = part.trim().toLowerCase();
		if (token && !seen.has(token)) {
			seen.add(token);
			out.push(token);
		}
	}
	return out;
}

/** Strip the surrounding brackets undici/URL keep on IPv6 literals (`[::1]` → `::1`). */
function unbracket(host: string): string {
	return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

const ALWAYS_BYPASS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * True when a request to `targetUrl` should skip the proxy given a no-proxy list. Matches: exact host,
 * `host:port`, leading-dot domain suffix (`.corp.example` matches `api.corp.example`), `*` (everything),
 * IPv4/IPv6 CIDR ranges (`10.0.0.0/8`), and always `localhost`/`127.0.0.1`/`::1`. Case-insensitive.
 */
export function hostBypassesProxy(
	targetUrl: string,
	noProxyHosts: string | string[] | null | undefined,
): boolean {
	let url: URL;
	try {
		url = new URL(targetUrl);
	} catch {
		return false;
	}
	const host = unbracket(url.hostname).toLowerCase();
	const port = url.port;
	const hostPort = port ? `${host}:${port}` : host;
	if (ALWAYS_BYPASS.has(host)) {
		return true;
	}
	const tokens = Array.isArray(noProxyHosts) ? noProxyHosts : parseNoProxyHosts(noProxyHosts);
	for (const token of tokens) {
		if (token === '*') {
			return true;
		}
		if (token === host || token === hostPort) {
			return true;
		}
		if (token.startsWith('.') && (host === token.slice(1) || host.endsWith(token))) {
			return true;
		}
		if (token.includes('/') && ipInCidr(host, token)) {
			return true;
		}
	}
	return false;
}

// --- CIDR matching (dependency-free) -----------------------------------------------------------

function ipv4ToInt(ip: string): bigint | null {
	const parts = ip.split('.');
	if (parts.length !== 4) {
		return null;
	}
	let value = 0n;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) {
			return null;
		}
		const n = Number(part);
		if (n > 255) {
			return null;
		}
		value = (value << 8n) | BigInt(n);
	}
	return value;
}

function ipv6ToInt(ip: string): bigint | null {
	// Reject anything that is clearly not IPv6.
	if (!ip.includes(':')) {
		return null;
	}
	const halves = ip.split('::');
	if (halves.length > 2) {
		return null;
	}
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const missing = 8 - (head.length + tail.length);
	if (halves.length === 1) {
		if (head.length !== 8) {
			return null;
		}
	} else if (missing < 0) {
		return null;
	}
	const groups = halves.length === 2 ? [...head, ...Array(missing).fill('0'), ...tail] : head;
	if (groups.length !== 8) {
		return null;
	}
	let value = 0n;
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) {
			return null;
		}
		value = (value << 16n) | BigInt(parseInt(group, 16));
	}
	return value;
}

/** True when `host` is a literal IP inside CIDR `token` (`10.0.0.0/8`, `fd00::/8`). DNS names never match. */
function ipInCidr(host: string, token: string): boolean {
	const slash = token.lastIndexOf('/');
	const base = token.slice(0, slash);
	const prefix = Number(token.slice(slash + 1));
	if (!Number.isInteger(prefix) || prefix < 0) {
		return false;
	}
	const v4Base = ipv4ToInt(base);
	if (v4Base !== null) {
		const hostInt = ipv4ToInt(host);
		if (hostInt === null || prefix > 32) {
			return false;
		}
		const mask = prefix === 0 ? 0n : (~0n << BigInt(32 - prefix)) & ((1n << 32n) - 1n);
		return (hostInt & mask) === (v4Base & mask);
	}
	const v6Base = ipv6ToInt(base);
	if (v6Base !== null) {
		const hostInt = ipv6ToInt(host);
		if (hostInt === null || prefix > 128) {
			return false;
		}
		const mask = prefix === 0 ? 0n : (~0n << BigInt(128 - prefix)) & ((1n << 128n) - 1n);
		return (hostInt & mask) === (v6Base & mask);
	}
	return false;
}

/**
 * True when `ip` matches any token in a CIDR/IP allowlist (e.g. `RATE_LIMIT_TRUSTED_CIDRS`). A token may
 * be a plain literal IP (exact match) or a CIDR range (`10.0.0.0/8`, `fd00::/8`). Reuses the same
 * dependency-free CIDR matcher as the proxy no-proxy logic. Bracketed IPv6 (`[::1]`) is tolerated.
 */
export function ipMatchesCidrList(
	ip: string,
	tokens: string | string[] | null | undefined,
): boolean {
	if (!ip) {
		return false;
	}
	const host = unbracket(ip.trim()).toLowerCase();
	const list = Array.isArray(tokens) ? tokens : parseNoProxyHosts(tokens);
	for (const token of list) {
		if (token.includes('/')) {
			if (ipInCidr(host, token)) {
				return true;
			}
		} else if (unbracket(token) === host) {
			return true;
		}
	}
	return false;
}

// --- Effective-routing preview (UI) ------------------------------------------------------------

export interface ProxyRoutingTarget {
	/** Logical label for the target (e.g. `baseUrl`, `oauthTokenUrl`). */
	label: string;
	/** The host extracted from the target URL, or null if the URL was unparseable. */
	host: string | null;
	/** Whether a request to this target would traverse the proxy or go direct. */
	routedThrough: 'proxy' | 'direct';
}

/**
 * Pure dry-run of dispatcher resolution for the admin UI: given the proxy config and a set of known
 * target URLs, report whether each would go `direct` or `via proxy`. Never makes a network call.
 */
export function previewProxyRouting(
	proxyEnabled: boolean,
	noProxyHosts: string | null | undefined,
	targets: Array<{ label: string; url: string | null | undefined }>,
): ProxyRoutingTarget[] {
	const tokens = parseNoProxyHosts(noProxyHosts);
	return targets
		.filter((t) => !!t.url)
		.map((t) => {
			let host: string | null = null;
			try {
				host = unbracket(new URL(t.url as string).hostname).toLowerCase();
			} catch {
				host = null;
			}
			const direct = !proxyEnabled || host === null || hostBypassesProxy(t.url as string, tokens);
			return { label: t.label, host, routedThrough: direct ? 'direct' : 'proxy' };
		});
}

/** Result of `POST /api/admin/api-connections/:id/test-proxy` — proxy-hop diagnostics only. */
export interface ProxyCheckResultDto {
	ok: boolean;
	/** Classified proxy-hop outcome. */
	status: ProxyCheckStatus;
	/** Human-readable, already-redacted message. */
	message: string;
	/** True when the probe actually traversed the proxy. */
	viaProxy: boolean;
	/** True when proxy was off or the target matched `noProxyHosts` (no-op, not a failure). */
	bypassed: boolean;
	/** Proxy host:port that was (or would be) used — never includes credentials. */
	proxyHost?: string | null;
}

/** Write-only proxy config fields shared by create/update request DTOs (password never returned). */
export interface ProxyConnectionRequestFields {
	proxyEnabled?: boolean;
	proxyUrl?: string | null;
	proxyUsername?: string | null;
	/** Write-only: omit on update to keep the stored password; `null` clears it; empty string rejected. */
	proxyPassword?: string | null;
	noProxyHosts?: string | null;
}
