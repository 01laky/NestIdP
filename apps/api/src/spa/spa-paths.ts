import { join } from 'path';
import { getWebIndexPath } from '../config/static-assets.config';

/** Anchor at api `dist/` (same as AppModule) so path resolves to `apps/web/dist`. */
export const WEB_INDEX_PATH = getWebIndexPath(join(__dirname, '..'));
