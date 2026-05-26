import { existsSync } from 'fs';
import { join } from 'path';

export const STATIC_ROUTE_EXCLUDES = ['/api*', '/saml*', '/health', '/ready'] as const;

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
