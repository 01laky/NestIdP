import { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';
import { PrismaService } from '@api/prisma/services/prisma.service';

function flushPromises(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe('AuditPersistenceService', () => {
	const prisma = {
		auditEvent: {
			create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
		},
	};

	let service: AuditPersistenceService;
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.clearAllMocks();
		service = new AuditPersistenceService(prisma as unknown as PrismaService);
		logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
		warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('API-AUD-PERS-01: recordSafe logs sanitized stdout payload', () => {
		service.recordSafe({
			category: 'admin_auth',
			event: 'admin_login_success',
			actorType: 'admin',
			actorId: 'a1',
			actorLabel: 'admin',
			clientIp: '127.0.0.1',
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0][0]));
		expect(payload).toMatchObject({
			event: 'admin_login_success',
			category: 'admin_auth',
			actorType: 'admin',
			actorId: 'a1',
		});
	});

	it('API-AUD-PERS-02: recordSafe persists sanitized metadata to prisma', async () => {
		service.recordSafe({
			category: 'admin_config',
			event: 'api_connection_created',
			actorType: 'admin',
			metadata: { name: 'Corp', bearerToken: 'must-not-persist' },
		});

		await flushPromises();

		expect(prisma.auditEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				event: 'api_connection_created',
				metadata: { name: 'Corp' },
			}),
		});
	});

	it('API-AUD-PERS-03: recordSafe omits metadata field when sanitized result is null', async () => {
		service.recordSafe({
			category: 'admin_auth',
			event: 'admin_login_failure',
			actorType: 'admin',
			metadata: null,
		});

		await flushPromises();

		const call = prisma.auditEvent.create.mock.calls[0][0];
		expect(call.data.metadata).toBeUndefined();
	});

	it('API-AUD-PERS-04: persist failure is logged and does not throw', async () => {
		prisma.auditEvent.create.mockRejectedValueOnce(new Error('db unavailable'));

		expect(() =>
			service.recordSafe({
				category: 'sync',
				event: 'sync_completed',
				actorType: 'system',
			}),
		).not.toThrow();

		await flushPromises();

		expect(warnSpy).toHaveBeenCalled();
		const warnPayload = JSON.parse(String(warnSpy.mock.calls[0][0]));
		expect(warnPayload).toMatchObject({ event: 'audit_persist_failed' });
	});

	it('API-AUD-PERS-05: stdout payload never includes denylisted metadata keys', () => {
		service.recordSafe({
			category: 'admin_config',
			event: 'idp_settings_updated',
			actorType: 'admin',
			metadata: { password: 'secret', fields: ['entityId'] },
		});

		const serialized = String(logSpy.mock.calls[0][0]);
		expect(serialized).not.toContain('secret');
		expect(JSON.parse(serialized).metadata).toEqual({ fields: ['entityId'] });
	});

	it('API-AUD-PERS-06: nullable actor and subject fields default to null in persist', async () => {
		service.recordSafe({
			category: 'saml',
			event: 'saml_response_issued',
			actorType: 'end_user',
		});

		await flushPromises();

		expect(prisma.auditEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				actorId: null,
				actorLabel: null,
				subjectType: null,
				subjectId: null,
				clientIp: null,
			}),
		});
	});
});
