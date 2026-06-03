import type { ApiConnection, PrismaClient } from '@prisma/client';
import { LOCAL_DIRECTORY_BASE_URL, LOCAL_DIRECTORY_CONNECTION_NAME } from '@nestidp/shared';

export type EncryptCredentialFn = (plaintext: string) => string;

export async function ensureLocalDirectoryConnection(
	prisma: PrismaClient,
	encrypt: EncryptCredentialFn,
): Promise<ApiConnection> {
	const existing = await prisma.apiConnection.findFirst({
		where: { isLocalDirectory: true },
	});
	if (existing) {
		return existing;
	}
	return prisma.apiConnection.create({
		data: {
			name: LOCAL_DIRECTORY_CONNECTION_NAME,
			baseUrl: LOCAL_DIRECTORY_BASE_URL,
			authType: 'BEARER',
			authCredentialsEncrypted: encrypt('local-directory-not-used'),
			isLocalDirectory: true,
		},
	});
}

export function manualExternalId(kind: 'user' | 'group' | 'role', recordId: string): string {
	return `manual:${kind}:${recordId}`;
}

export function toOriginLiteral(origin: 'MANUAL' | 'SYNCED'): 'manual' | 'synced' {
	return origin === 'MANUAL' ? 'manual' : 'synced';
}
