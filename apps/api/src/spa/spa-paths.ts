import { getWebIndexPath } from '../config/static-assets.config';

/** Resolved at module load from compiled or source spa directory. */
export const WEB_INDEX_PATH = getWebIndexPath(__dirname);
