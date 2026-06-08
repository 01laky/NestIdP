import type { ProxyCheckStatus } from '@nestidp/shared';

/**
 * Classify an outbound `fetch`/undici failure into a proxy-hop {@link ProxyCheckStatus} so the operator
 * sees *which* hop failed (Prompt 33 §6). undici buries the real cause: a CONNECT rejection surfaces as
 * a nested `AbortError` with `message: "Proxy response (407) !== 200 when HTTP Tunneling"`, and a dead
 * proxy as an `ECONNREFUSED`/timeout. We walk the whole `cause` chain to find it.
 */

const TLS_ERROR_CODES = new Set([
	'CERT_HAS_EXPIRED',
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'ERR_TLS_CERT_ALTNAME_INVALID',
	'CERT_UNTRUSTED',
	'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const PROXY_UNREACHABLE_CODES = new Set([
	'ECONNREFUSED',
	'ENOTFOUND',
	'EAI_AGAIN',
	'ETIMEDOUT',
	'ECONNRESET',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'UND_ERR_CONNECT_TIMEOUT',
]);

interface ChainNode {
	name?: string;
	code?: string;
	message?: string;
	statusCode?: number;
}

/** Flatten an error's `cause` chain (bounded) into name/code/message/statusCode tuples. */
function chain(error: unknown): ChainNode[] {
	const out: ChainNode[] = [];
	let node: unknown = error;
	let depth = 0;
	while (node && typeof node === 'object' && depth < 8) {
		const e = node as {
			name?: unknown;
			code?: unknown;
			message?: unknown;
			statusCode?: unknown;
			cause?: unknown;
		};
		out.push({
			name: typeof e.name === 'string' ? e.name : undefined,
			code: typeof e.code === 'string' ? e.code : undefined,
			message: typeof e.message === 'string' ? e.message : undefined,
			statusCode: typeof e.statusCode === 'number' ? e.statusCode : undefined,
		});
		node = e.cause;
		depth += 1;
	}
	return out;
}

/** Parse the CONNECT tunnel rejection status undici embeds in a message, e.g. 407. */
function tunnelStatus(nodes: ChainNode[]): number | null {
	for (const n of nodes) {
		const m = n.message?.match(/Proxy response \((\d{3})\) !== 200 when HTTP Tunneling/i);
		if (m) {
			return Number(m[1]);
		}
	}
	return null;
}

export interface ProxyFailureClassification {
	status: ProxyCheckStatus;
	/** Short, hop-naming message (no secret). */
	message: string;
}

/**
 * Classify a thrown outbound error. `proxied=false` never returns a proxy-specific status — direct
 * failures keep their existing wording elsewhere; here we only emit `unreachable`/`tls_error`/`target_error`.
 */
export function classifyProxyError(
	error: unknown,
	opts: { proxied: boolean },
): ProxyFailureClassification {
	const nodes = chain(error);
	const codes = new Set(nodes.map((n) => n.code).filter(Boolean) as string[]);
	const isTimeout =
		nodes.some((n) => n.name === 'TimeoutError') || codes.has('UND_ERR_HEADERS_TIMEOUT');

	if (opts.proxied) {
		const status = tunnelStatus(nodes);
		if (status === 407) {
			return { status: 'auth_failed', message: 'proxy rejected the credentials (407)' };
		}
		if (status !== null) {
			return {
				status: 'tunnel_failed',
				message: `proxy could not open a tunnel to the target (${status})`,
			};
		}
	}

	if ([...codes].some((c) => TLS_ERROR_CODES.has(c))) {
		return { status: 'tls_error', message: 'TLS certificate verification failed' };
	}

	if ([...codes].some((c) => PROXY_UNREACHABLE_CODES.has(c))) {
		return {
			status: opts.proxied ? 'unreachable' : 'target_error',
			message: opts.proxied ? 'proxy could not be reached' : 'target could not be reached',
		};
	}

	if (isTimeout) {
		return {
			status: opts.proxied ? 'unreachable' : 'target_error',
			message: opts.proxied ? 'proxy connection timed out' : 'target request timed out',
		};
	}

	return {
		status: opts.proxied ? 'unreachable' : 'target_error',
		message: opts.proxied ? 'could not reach target via proxy' : 'could not reach target',
	};
}

/**
 * Suffix an existing direct-connection error message with a proxy hint when the call was proxied, so a
 * proxied failure reads distinctly from a direct one without losing the original wording.
 */
export function annotateIfProxied(message: string, error: unknown, proxied: boolean): string {
	if (!proxied) {
		return message;
	}
	const { status } = classifyProxyError(error, { proxied: true });
	if (status === 'auth_failed') {
		return `${message} (proxy rejected credentials)`;
	}
	if (status === 'tunnel_failed') {
		return `${message} (proxy tunnel failed)`;
	}
	if (status === 'unreachable') {
		return `${message} (via proxy — proxy unreachable)`;
	}
	return `${message} (via proxy)`;
}
