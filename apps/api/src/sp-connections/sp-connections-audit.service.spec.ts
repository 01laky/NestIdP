import { SpConnectionsAuditService } from './sp-connections-audit.service';

describe('SpConnectionsAuditService', () => {
	it('API-SPC-AUDIT-01: logs created/updated/deleted/acs tested as JSON', () => {
		const service = new SpConnectionsAuditService();
		const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

		service.logCreated('sp-1', 'urn:sp:1');
		service.logUpdated('sp-1', 'urn:sp:1');
		service.logDeleted('sp-1', 'urn:sp:1');
		service.logAcsTested('sp-1', true, 200);

		expect(logSpy).toHaveBeenCalledTimes(4);
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
			event: 'sp_connection_created',
			id: 'sp-1',
		});
		expect(JSON.parse(String(logSpy.mock.calls[3][0]))).toMatchObject({
			event: 'sp_connection_acs_tested',
			reachable: true,
			statusCode: 200,
		});

		logSpy.mockRestore();
	});
});
