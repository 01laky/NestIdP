import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helpersDir = dirname(fileURLToPath(import.meta.url));

/** `apps/web` package root */
export const webRoot = join(helpersDir, '../..');

/** `apps/web/src` */
export const webSrc = join(webRoot, 'src');

export const evergreenDir = join(webSrc, 'styles/evergreen');

export const i18nDir = join(webSrc, 'i18n');

/** Monorepo root */
export const repoRoot = join(webRoot, '../..');
