import {
	getWebDistPath,
	getWebIndexPath,
	resolveWebDistExists,
	shouldEnableStaticServing,
	STATIC_ROUTE_EXCLUDES,
} from './static-assets.config';

jest.mock('fs', () => ({
	existsSync: jest.fn(),
}));

import { existsSync } from 'fs';

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

describe('static-assets.config', () => {
	describe('shouldEnableStaticServing', () => {
		it('enables static serving only in production when dist exists', () => {
			expect(shouldEnableStaticServing('production', true)).toBe(true);
		});

		it('disables static serving in development even when dist exists', () => {
			expect(shouldEnableStaticServing('development', true)).toBe(false);
		});

		it('disables static serving in test environment', () => {
			expect(shouldEnableStaticServing('test', true)).toBe(false);
		});

		it('disables static serving in production when dist is missing', () => {
			expect(shouldEnableStaticServing('production', false)).toBe(false);
		});

		it('disables static serving when NODE_ENV is undefined', () => {
			expect(shouldEnableStaticServing(undefined, true)).toBe(false);
		});
	});

	describe('path helpers', () => {
		it('builds web dist path relative to api compiled directory', () => {
			expect(getWebDistPath('/app/apps/api/dist')).toMatch(/web[/\\]dist$/);
		});

		it('builds index.html path inside web dist', () => {
			expect(getWebIndexPath('/app/apps/api/dist')).toMatch(/web[/\\]dist[/\\]index\.html$/);
		});

		it('resolveWebDistExists delegates to existsSync on dist path', () => {
			mockedExistsSync.mockReturnValue(true);
			expect(resolveWebDistExists('/app/apps/api/dist')).toBe(true);
			expect(mockedExistsSync).toHaveBeenCalledWith(getWebDistPath('/app/apps/api/dist'));
		});
	});

	describe('STATIC_ROUTE_EXCLUDES', () => {
		it('excludes API, SAML, and health endpoints from SPA static handler', () => {
			expect(STATIC_ROUTE_EXCLUDES).toEqual(['/api*', '/saml*', '/health', '/ready']);
		});

		it('does not exclude admin or login SPA routes', () => {
			expect(STATIC_ROUTE_EXCLUDES.some((path) => path.includes('admin'))).toBe(false);
			expect(STATIC_ROUTE_EXCLUDES.some((path) => path.includes('login'))).toBe(false);
		});
	});
});
