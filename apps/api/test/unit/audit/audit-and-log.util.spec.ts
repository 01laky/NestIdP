import type { Logger } from '@nestjs/common';
import { recordAndLog } from '@api/audit/utils/audit-and-log.util';
import type {
	AuditPersistenceService,
	AuditRecordInput,
} from '@api/audit/services/audit-persistence.service';

/**
 * Edge-case coverage for the shared `recordAndLog` helper (Prompt 38 §6.2/§A3). It must reproduce the old
 * per-service light stdout line `{event, id: subjectId, ...metadata}` EXACTLY and still call recordSafe with
 * the untouched input — the connection audit services were de-duplicated onto it and their log shape is
 * asserted elsewhere, so any drift here is a behaviour change.
 */
describe('recordAndLog (§6.2)', () => {
	function harness() {
		const logger = { log: jest.fn() } as unknown as Logger;
		const audit = { recordSafe: jest.fn() } as unknown as AuditPersistenceService;
		return {
			logger,
			audit,
			logSpy: logger.log as jest.Mock,
			recordSpy: audit.recordSafe as jest.Mock,
		};
	}

	it('API-RECLOG-01: emits {event, id, ...metadata} then persists the full input', () => {
		const { logger, audit, logSpy, recordSpy } = harness();
		const input: AuditRecordInput = {
			category: 'admin_config',
			event: 'sp_connection_created',
			actorType: 'admin',
			subjectType: 'SpConnection',
			subjectId: 'sp-1',
			metadata: { spEntityId: 'urn:sp' },
		};
		recordAndLog(audit, logger, input);

		expect(logSpy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'sp_connection_created',
			id: 'sp-1',
			spEntityId: 'urn:sp',
		});
		expect(recordSpy).toHaveBeenCalledTimes(1);
		expect(recordSpy).toHaveBeenCalledWith(input);
	});

	it('API-RECLOG-02: logs before it persists (ordering preserved)', () => {
		const { logger, audit, logSpy, recordSpy } = harness();
		const order: string[] = [];
		logSpy.mockImplementation(() => order.push('log'));
		recordSpy.mockImplementation(() => order.push('record'));
		recordAndLog(audit, logger, {
			category: 'admin_config',
			event: 'e' as never, // synthetic — the util is registry-agnostic
			actorType: 'admin',
			subjectId: 'x',
		});
		expect(order).toEqual(['log', 'record']);
	});

	it('API-RECLOG-03: missing metadata → log line is just {event, id}', () => {
		const { logger, audit, logSpy } = harness();
		recordAndLog(audit, logger, {
			category: 'admin_config',
			event: 'sp_connection_deleted',
			actorType: 'admin',
			subjectId: 'sp-9',
		});
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'sp_connection_deleted',
			id: 'sp-9',
		});
	});

	it('API-RECLOG-04: undefined subjectId serialises to an absent id (JSON drops undefined)', () => {
		const { logger, audit, logSpy } = harness();
		recordAndLog(audit, logger, {
			category: 'saml',
			event: 'saml_request_rejected',
			actorType: 'system',
			metadata: { reason: 'bad' },
		});
		const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
		expect(parsed).toEqual({ event: 'saml_request_rejected', reason: 'bad' });
		expect('id' in parsed).toBe(false);
	});

	it('API-RECLOG-05: metadata keys named "event"/"id" override the defaults (spread order)', () => {
		const { logger, audit, logSpy } = harness();
		recordAndLog(audit, logger, {
			category: 'saml',
			event: 'base_event' as never, // synthetic — the util is registry-agnostic
			actorType: 'system',
			subjectId: 'base-id',
			metadata: { event: 'shadowed' as never, id: 'shadowed-id', extra: 1 },
		});
		// Documents that metadata is spread LAST and therefore wins — callers must not collide on these keys.
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'shadowed' as never,
			id: 'shadowed-id',
			extra: 1,
		});
	});

	it('API-RECLOG-06: null subjectId is serialised as id:null', () => {
		const { logger, audit, logSpy } = harness();
		recordAndLog(audit, logger, {
			category: 'saml',
			event: 'e' as never, // synthetic — the util is registry-agnostic
			actorType: 'system',
			subjectId: null,
		});
		const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
		expect(parsed.id).toBeNull();
	});
});
