import { ApiConnectionsAuditService } from './api-connections-audit.service';

describe('ApiConnectionsAuditService', () => {
	it('API-CON-AUDIT-01: logs lifecycle and test events', () => {
		const service = new ApiConnectionsAuditService();
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
});
