import { join } from 'path';
import { getWebIndexPath } from '../config/static-assets.config';
import { WEB_INDEX_PATH } from './spa-paths';

describe('spa-paths', () => {
	it('resolves index.html from dist/spa the same as from dist root', () => {
		const fromDistRoot = getWebIndexPath('/app/apps/api/dist');
		const fromSpaModule = getWebIndexPath(join('/app/apps/api/dist/spa', '..'));
		expect(fromSpaModule).toBe(fromDistRoot);
	});

	it('WEB_INDEX_PATH points at apps/web/dist/index.html', () => {
		expect(WEB_INDEX_PATH).toMatch(/apps[/\\]web[/\\]dist[/\\]index\.html$/);
	});
});
