import type { ApiConnection } from '@prisma/client';
import { toApiConnectionDto } from '@api/api-connections/mappers/api-connections.mapper';
import { SCHEDULE_FIELD_DEFAULTS } from '../../support/prisma/test-fixtures';

describe('toApiConnectionDto', () => {
	const baseRow: ApiConnection = {
		id: 'clxyz1234567890123456789012',
		name: 'Corp API',
		baseUrl: 'https://identity.example.com',
		authType: 'BEARER',
		authCredentialsEncrypted: 'v1:encrypted',
		isLocalDirectory: false,
		apiContractConfig: null,
		oauthTokenUrl: null,
		oauthClientId: null,
		oauthClientSecretEncrypted: null,
		oauthScope: null,
		oauthAudience: null,
		oauthClientAuthMethod: null,
		oauthTokenRequestParams: null,
		lastSyncAt: new Date('2026-02-01T12:00:00.000Z'),
		lastSyncStatus: 'SUCCESS',
		...SCHEDULE_FIELD_DEFAULTS,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
	};

	it('API-MAP-01: maps all public fields to ISO strings', () => {
		const dto = toApiConnectionDto(baseRow);
		expect(dto).toEqual({
			id: baseRow.id,
			name: 'Corp API',
			baseUrl: 'https://identity.example.com',
			authType: 'BEARER',
			hasBearerToken: true,
			apiContractConfig: null,
			oauthTokenUrl: null,
			oauthClientId: null,
			oauthScope: null,
			oauthAudience: null,
			oauthClientAuthMethod: null,
			oauthTokenRequestParams: null,
			hasOauthClientSecret: false,
			oauthLastTokenAt: null,
			lastSyncAt: '2026-02-01T12:00:00.000Z',
			lastSyncStatus: 'SUCCESS',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
		});
		expect(dto).not.toHaveProperty('authCredentialsEncrypted');
		expect(dto).not.toHaveProperty('bearerToken');
	});

	it('API-MAP-02: hasBearerToken false when encrypted column empty', () => {
		const dto = toApiConnectionDto({ ...baseRow, authCredentialsEncrypted: '' });
		expect(dto.hasBearerToken).toBe(false);
	});

	it('API-MAP-03: lastSyncAt null when never synced', () => {
		const dto = toApiConnectionDto({ ...baseRow, lastSyncAt: null, lastSyncStatus: 'NEVER' });
		expect(dto.lastSyncAt).toBeNull();
		expect(dto.lastSyncStatus).toBe('NEVER');
	});
});
