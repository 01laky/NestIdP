import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';

@Injectable()
export class SpConnectionsAuditService {
	private readonly logger = new Logger(SpConnectionsAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	logCreated(id: string, spEntityId: string): void {
		const payload = { event: 'sp_connection_created', id, spEntityId };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'sp_connection_created',
			actorType: 'admin',
			subjectType: 'SpConnection',
			subjectId: id,
			metadata: { spEntityId },
		});
	}

	logUpdated(id: string, spEntityId: string): void {
		const payload = { event: 'sp_connection_updated', id, spEntityId };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'sp_connection_updated',
			actorType: 'admin',
			subjectType: 'SpConnection',
			subjectId: id,
			metadata: { spEntityId },
		});
	}

	logDeleted(id: string, spEntityId: string): void {
		const payload = { event: 'sp_connection_deleted', id, spEntityId };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'sp_connection_deleted',
			actorType: 'admin',
			subjectType: 'SpConnection',
			subjectId: id,
			metadata: { spEntityId },
		});
	}

	logAcsTested(id: string, reachable: boolean, statusCode?: number): void {
		const payload = {
			event: 'sp_connection_acs_tested',
			id,
			reachable,
			statusCode: statusCode ?? null,
		};
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'sp_connection_acs_tested',
			actorType: 'admin',
			subjectType: 'SpConnection',
			subjectId: id,
			metadata: { reachable, statusCode: statusCode ?? null },
		});
	}
}
