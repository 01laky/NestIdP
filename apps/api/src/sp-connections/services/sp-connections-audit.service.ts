import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { recordAndLog } from '../../audit/utils/audit-and-log.util';

@Injectable()
export class SpConnectionsAuditService {
	private readonly logger = new Logger(SpConnectionsAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	private record(event: string, id: string, metadata: Record<string, unknown>): void {
		recordAndLog(this.audit, this.logger, {
			category: 'admin_config',
			event,
			actorType: 'admin',
			subjectType: 'SpConnection',
			subjectId: id,
			metadata,
		});
	}

	logCreated(id: string, spEntityId: string): void {
		this.record('sp_connection_created', id, { spEntityId });
	}

	logUpdated(id: string, spEntityId: string): void {
		this.record('sp_connection_updated', id, { spEntityId });
	}

	logDeleted(id: string, spEntityId: string): void {
		this.record('sp_connection_deleted', id, { spEntityId });
	}

	logSigningProbe(id: string, spEntityId: string, ok: boolean): void {
		this.record('sp_signing_probe_performed', id, { spEntityId, ok });
	}

	logAcsTested(id: string, reachable: boolean, statusCode?: number): void {
		this.record('sp_connection_acs_tested', id, { reachable, statusCode: statusCode ?? null });
	}
}
