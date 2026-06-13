export type SpMetadataFetchErrorCode =
	| 'invalid_url'
	| 'timeout'
	| 'unreachable'
	| 'http_error'
	| 'too_large'
	| 'too_many_redirects';

export class SpMetadataFetchError extends Error {
	constructor(
		message: string,
		public readonly code: SpMetadataFetchErrorCode,
	) {
		super(message);
		this.name = 'SpMetadataFetchError';
	}
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchSpMetadataOptions {
	timeoutMs: number;
	maxBytes: number;
	maxRedirects: number;
	/** Injectable for tests; defaults to the global fetch (undici). */
	fetchImpl?: typeof fetch;
}

/** Read a fetch Response body with a hard byte cap; streams when possible, aborting past the cap. */
async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
	const contentLength = Number(res.headers.get?.('content-length'));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		throw new SpMetadataFetchError('Metadata document is too large', 'too_large');
	}
	const reader = res.body?.getReader?.();
	if (!reader) {
		// Test/mocked responses: fall back to text() then enforce the cap on the decoded length.
		const text = await res.text();
		if (Buffer.byteLength(text, 'utf8') > maxBytes) {
			throw new SpMetadataFetchError('Metadata document is too large', 'too_large');
		}
		return text;
	}
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (value) {
			received += value.length;
			if (received > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new SpMetadataFetchError('Metadata document is too large', 'too_large');
			}
			chunks.push(value);
		}
	}
	return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Fetch an SP metadata document server-side (Prompt 42). Bounded by timeout, response size, and a manual
 * redirect cap (so a hostile/looping endpoint cannot amplify or exhaust memory). The URL is operator-
 * supplied and trusted; HTTPS is preferred but http is allowed (the caller warns). Never logs the body;
 * failures map to a typed {@link SpMetadataFetchError}.
 */
export async function fetchSpMetadataDocument(
	url: string,
	options: FetchSpMetadataOptions,
): Promise<string> {
	const doFetch = options.fetchImpl ?? fetch;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new SpMetadataFetchError('Invalid metadata URL', 'invalid_url');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new SpMetadataFetchError('Metadata URL must be http(s)', 'invalid_url');
	}

	let current = parsed.toString();
	for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
		let res: Response;
		try {
			res = await doFetch(current, {
				method: 'GET',
				redirect: 'manual',
				signal: AbortSignal.timeout(options.timeoutMs),
				headers: {
					Accept: 'application/samlmetadata+xml, application/xml, text/xml, */*;q=0.1',
				},
			});
		} catch (error) {
			if (
				error instanceof Error &&
				(error.name === 'TimeoutError' || error.name === 'AbortError')
			) {
				throw new SpMetadataFetchError('Metadata fetch timed out', 'timeout');
			}
			throw new SpMetadataFetchError('Metadata endpoint unreachable', 'unreachable');
		}

		if (REDIRECT_STATUSES.has(res.status)) {
			if (hop === options.maxRedirects) {
				throw new SpMetadataFetchError('Too many redirects', 'too_many_redirects');
			}
			const location = res.headers.get?.('location');
			if (!location) {
				throw new SpMetadataFetchError('Redirect without a Location header', 'http_error');
			}
			try {
				current = new URL(location, current).toString();
			} catch {
				throw new SpMetadataFetchError('Invalid redirect Location', 'http_error');
			}
			await res.body?.cancel?.().catch(() => undefined);
			continue;
		}

		if (!res.ok) {
			throw new SpMetadataFetchError(`Metadata endpoint returned HTTP ${res.status}`, 'http_error');
		}
		return readBodyCapped(res, options.maxBytes);
	}
	throw new SpMetadataFetchError('Too many redirects', 'too_many_redirects');
}
