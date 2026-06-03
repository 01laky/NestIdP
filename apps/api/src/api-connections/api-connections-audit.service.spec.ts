import { AuditPersistenceService } from '../audit/audit-persistence.service';
import { ApiConnectionsAuditService } from './api-connections-audit.service';

describe('ApiConnectionsAuditService', () => {
	const audit = { recordSafe: jest.fn() };

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-CON-AUDIT-01: logs lifecycle and test events', () => {
		const service = new ApiConnectionsAuditService(audit as unknown as AuditPersistenceService);
		const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

		service.logCreated('c1', 'Corp');
		service.logUpdated('c1', 'Corp');
		service.logDeleted('c1', 'Corp');
		service.logTested('c1', false);

		expect(logSpy).toHaveBeenCalledTimes(4);
		expect(JSON.parse(String(logSpy.mock.calls[3][0]))).toMatchObject({
			event: 'api_connection_tested',
			reachable: false,
			statusCode: null,
		});

		logSpy.mockRestore();
	});

	it('API-CON-AUDIT-02: created event payload has no bearer token field', () => {
		const service = new ApiConnectionsAuditService(audit as unknown as AuditPersistenceService);
		const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

		service.logCreated('c1', 'Corp');

		const payload = JSON.parse(String(logSpy.mock.calls[0][0]));
		expect(payload).toMatchObject({ event: 'api_connection_created', id: 'c1', name: 'Corp' });
		expect(payload.bearerToken).toBeUndefined();
		expect(JSON.stringify(payload)).not.toContain('secret');

		logSpy.mockRestore();
	});

	it('API-CON-AUDIT-03: tested event includes reachable without credentials', () => {
		const service = new ApiConnectionsAuditService(audit as unknown as AuditPersistenceService);
		const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

		service.logTested('c1', true, 200);

		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
			event: 'api_connection_tested',
			reachable: true,
			statusCode: 200,
		});

		logSpy.mockRestore();
	});
});
