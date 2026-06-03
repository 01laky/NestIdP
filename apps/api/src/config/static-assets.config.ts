import { existsSync } from 'fs';
import { join } from 'path';

/** Named wildcards required by path-to-regexp v8 (Express 5 / @nestjs/serve-static 5). */
export const STATIC_ROUTE_EXCLUDES = [
	'/api*rest',
	'/saml*rest',
	'/health',
	'/ready',
] as const;

export function getWebDistPath(fromDirname: string): string {
	return join(fromDirname, '..', '..', 'web', 'dist');
}

export function getWebIndexPath(fromDirname: string): string {
	return join(getWebDistPath(fromDirname), 'index.html');
}

export function shouldEnableStaticServing(
	nodeEnv: string | undefined,
	distPathExists: boolean,
): boolean {
	return nodeEnv === 'production' && distPathExists;
}

export function resolveWebDistExists(fromDirname: string): boolean {
	return existsSync(getWebDistPath(fromDirname));
}
