/**
 * Best-effort SSRF guard for admin-triggered outbound requests to operator-supplied URLs (§5.A10).
 *
 * Rejects URLs whose host is a loopback / private / link-local / unique-local address literal, or an
 * obvious internal hostname. This blocks the high-value targets (cloud metadata `169.254.169.254`,
 * `localhost`, RFC1918 ranges) without a DNS round-trip. It does NOT defend against DNS-rebinding or a
 * public name that resolves to a private IP — callers should additionally use `redirect: 'manual'` so a
 * public URL cannot bounce to an internal one. Full resolve-time validation is out of scope here.
 *
 * Throws {@link SsrfBlockedError} when the host is disallowed.
 */
export class SsrfBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SsrfBlockedError';
	}
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];
const BLOCKED_HOST_NAMES = ['localhost'];

export function isPrivateOrLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

	if (BLOCKED_HOST_NAMES.includes(host)) {
		return true;
	}
	if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
		return true;
	}

	const v4 = parseIpv4(host);
	if (v4) {
		return isPrivateIpv4(v4);
	}

	// IPv6 literals (already stripped of brackets above)
	if (host === '::1' || host === '::') {
		return true;
	}
	// IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254
	const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (mapped) {
		const inner = parseIpv4(mapped[1]);
		return inner ? isPrivateIpv4(inner) : false;
	}
	// fc00::/7 unique-local, fe80::/10 link-local
	if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
		return true;
	}

	return false;
}

export function assertNotPrivateHost(rawUrl: string): void {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SsrfBlockedError('URL is malformed');
	}
	if (isPrivateOrLoopbackHost(url.hostname)) {
		throw new SsrfBlockedError(
			`Refusing to contact a private/loopback/link-local host: ${url.hostname}`,
		);
	}
}

function parseIpv4(host: string): [number, number, number, number] | null {
	const parts = host.split('.');
	if (parts.length !== 4) {
		return null;
	}
	const octets = parts.map((p) => Number(p));
	if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return null;
	}
	return octets as [number, number, number, number];
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
	if (a === 127) return true; // loopback 127.0.0.0/8
	if (a === 10) return true; // 10.0.0.0/8
	if (a === 0) return true; // 0.0.0.0/8 (this host)
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
	return false;
}
