import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';

@Injectable()
export class ApiConnectionsAuditService {
	private readonly logger = new Logger(ApiConnectionsAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	logCreated(id: string, name: string): void {
		const payload = { event: 'api_connection_created', id, name };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_created',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { name },
		});
	}

	logUpdated(id: string, name: string): void {
		const payload = { event: 'api_connection_updated', id, name };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_updated',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { name },
		});
	}

	logDeleted(id: string, name: string): void {
		const payload = { event: 'api_connection_deleted', id, name };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_deleted',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { name },
		});
	}

	logTested(id: string, reachable: boolean, statusCode?: number): void {
		const payload = {
			event: 'api_connection_tested',
			id,
			reachable,
			statusCode: statusCode ?? null,
		};
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_tested',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { reachable, statusCode: statusCode ?? null },
		});
	}
}
