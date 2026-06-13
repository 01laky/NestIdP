import {
	fetchSpMetadataDocument,
	SpMetadataFetchError,
} from '@api/sp-connections/utils/sp-metadata-fetch.util';

interface MockResponseInit {
	ok?: boolean;
	status?: number;
	headers?: Record<string, string>;
	text?: string;
}

function mockResponse(init: MockResponseInit): Response {
	const headers = init.headers ?? {};
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		headers: {
			get: (name: string) => headers[name.toLowerCase()] ?? null,
		},
		text: async () => init.text ?? '',
		body: undefined,
	} as unknown as Response;
}

const OPTS = { timeoutMs: 5000, maxBytes: 1024, maxRedirects: 3 };

describe('fetchSpMetadataDocument (Prompt 42)', () => {
	it('SPM-FETCH-01: a 200 XML response returns the body', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(mockResponse({ text: '<md/>' }));
		const xml = await fetchSpMetadataDocument('https://sp.example.com/metadata', {
			...OPTS,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(xml).toBe('<md/>');
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://sp.example.com/metadata',
			expect.objectContaining({ method: 'GET', redirect: 'manual' }),
		);
	});

	it('SPM-FETCH-02a: non-2xx → http_error', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(mockResponse({ ok: false, status: 404 }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'http_error' });
	});

	it('SPM-FETCH-02b: timeout (AbortSignal) → timeout', async () => {
		const fetchImpl = jest
			.fn()
			.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'timeout' });
	});

	it('SPM-FETCH-02c: network error → unreachable', async () => {
		const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'unreachable' });
	});

	it('SPM-FETCH-02d: body over the cap (Content-Length) → too_large', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(mockResponse({ headers: { 'content-length': '999999' }, text: 'x' }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'too_large' });
	});

	it('SPM-FETCH-02e: body over the cap (decoded length, no Content-Length) → too_large', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(mockResponse({ text: 'x'.repeat(2000) }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'too_large' });
	});

	it('SPM-FETCH-03a: a relative / non-http(s) URL → invalid_url', async () => {
		const fetchImpl = jest.fn();
		await expect(
			fetchSpMetadataDocument('not a url', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'invalid_url' });
		await expect(
			fetchSpMetadataDocument('ftp://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'invalid_url' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('SPM-FETCH-03b: http (non-https) URL is allowed (caller warns)', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(mockResponse({ text: '<md/>' }));
		await expect(
			fetchSpMetadataDocument('http://sp.example.com/m', {
				...OPTS,
				fetchImpl: fetchImpl as never,
			}),
		).resolves.toBe('<md/>');
	});

	it('SPM-FETCH-04a: follows a redirect within the cap', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValueOnce(
				mockResponse({ status: 302, headers: { location: 'https://sp.example.com/final' } }),
			)
			.mockResolvedValueOnce(mockResponse({ text: '<md-final/>' }));
		const xml = await fetchSpMetadataDocument('https://sp.example.com/start', {
			...OPTS,
			fetchImpl: fetchImpl as never,
		});
		expect(xml).toBe('<md-final/>');
		expect(fetchImpl).toHaveBeenNthCalledWith(
			2,
			'https://sp.example.com/final',
			expect.any(Object),
		);
	});

	it('SPM-FETCH-04b: exceeding the redirect cap → too_many_redirects', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(mockResponse({ status: 302, headers: { location: 'https://sp/loop' } }));
		await expect(
			fetchSpMetadataDocument('https://sp/start', {
				...OPTS,
				maxRedirects: 1,
				fetchImpl: fetchImpl as never,
			}),
		).rejects.toMatchObject({ code: 'too_many_redirects' });
	});

	it('SPM-FETCH-04c: a redirect without a Location header → http_error', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(mockResponse({ status: 302 }));
		await expect(
			fetchSpMetadataDocument('https://sp/start', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'http_error' });
	});

	it('exposes SpMetadataFetchError as the thrown type', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(mockResponse({ ok: false, status: 500 }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toBeInstanceOf(SpMetadataFetchError);
	});

	// --- streaming body (real undici path) ---------------------------------------------------------

	function streamResponse(chunks: string[], cancel = jest.fn()): Response {
		const encoder = new TextEncoder();
		let i = 0;
		return {
			ok: true,
			status: 200,
			headers: { get: () => null },
			body: {
				getReader: () => ({
					read: async () =>
						i < chunks.length
							? { done: false, value: encoder.encode(chunks[i++]) }
							: { done: true, value: undefined },
					cancel,
				}),
			},
		} as unknown as Response;
	}

	it('SPM-FETCH-05: a streamed body is concatenated and decoded (UTF-8)', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(streamResponse(['<md>', 'ščä</md>']));
		const xml = await fetchSpMetadataDocument('https://sp/m', {
			...OPTS,
			fetchImpl: fetchImpl as never,
		});
		expect(xml).toBe('<md>ščä</md>');
	});

	it('SPM-FETCH-05b: a streamed body over the cap aborts mid-stream → too_large', async () => {
		const cancel = jest.fn().mockResolvedValue(undefined);
		// 3 chunks of 500 bytes each = 1500 > 1024 cap; the reader is cancelled.
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(
				streamResponse(['x'.repeat(500), 'y'.repeat(500), 'z'.repeat(500)], cancel),
			);
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'too_large' });
		expect(cancel).toHaveBeenCalled();
	});

	it('SPM-FETCH-06: an AbortError (not just TimeoutError) maps to timeout', async () => {
		const fetchImpl = jest
			.fn()
			.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).rejects.toMatchObject({ code: 'timeout' });
	});

	it('SPM-FETCH-07: follows two redirects within the cap', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValueOnce(mockResponse({ status: 301, headers: { location: 'https://sp/2' } }))
			.mockResolvedValueOnce(mockResponse({ status: 307, headers: { location: 'https://sp/3' } }))
			.mockResolvedValueOnce(mockResponse({ text: '<md-final/>' }));
		const xml = await fetchSpMetadataDocument('https://sp/1', {
			...OPTS,
			maxRedirects: 3,
			fetchImpl: fetchImpl as never,
		});
		expect(xml).toBe('<md-final/>');
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('SPM-FETCH-07b: maxRedirects=0 with an immediate redirect → too_many_redirects', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(mockResponse({ status: 302, headers: { location: 'https://sp/next' } }));
		await expect(
			fetchSpMetadataDocument('https://sp/start', {
				...OPTS,
				maxRedirects: 0,
				fetchImpl: fetchImpl as never,
			}),
		).rejects.toMatchObject({ code: 'too_many_redirects' });
	});

	it('SPM-FETCH-08: a relative redirect Location is resolved against the current URL', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValueOnce(mockResponse({ status: 302, headers: { location: '/idp/meta.xml' } }))
			.mockResolvedValueOnce(mockResponse({ text: '<md/>' }));
		await fetchSpMetadataDocument('https://sp.example.com/start', {
			...OPTS,
			fetchImpl: fetchImpl as never,
		});
		expect(fetchImpl).toHaveBeenNthCalledWith(
			2,
			'https://sp.example.com/idp/meta.xml',
			expect.any(Object),
		);
	});

	it('SPM-FETCH-09: Content-Length within the cap succeeds; header lookup is case-insensitive', async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(mockResponse({ headers: { 'content-length': '5' }, text: '<md/>' }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).resolves.toBe('<md/>');
	});

	it('SPM-FETCH-10: an empty 200 body returns an empty string (the parser handles invalidity)', async () => {
		const fetchImpl = jest.fn().mockResolvedValue(mockResponse({ text: '' }));
		await expect(
			fetchSpMetadataDocument('https://sp/m', { ...OPTS, fetchImpl: fetchImpl as never }),
		).resolves.toBe('');
	});
});
