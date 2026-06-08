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

	logContractUpdated(id: string, name: string, customizedSections: string[]): void {
		const payload = { event: 'api_connection_contract_updated', id, name, customizedSections };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_contract_updated',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { name, customizedSections },
		});
	}

	logAuthTypeChanged(id: string, name: string, authType: string): void {
		const payload = { event: 'api_connection_auth_type_changed', id, name, authType };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_auth_type_changed',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { name, authType },
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

	logProxyUpdated(
		id: string,
		name: string,
		detail: { enabled: boolean; proxyHost: string | null; hasAuth: boolean; hasNoProxy: boolean },
	): void {
		const payload = { event: 'api_connection_proxy_updated', id, name, ...detail };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_proxy_updated',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { name, ...detail },
		});
	}

	logProxyChecked(
		id: string,
		name: string,
		status: string,
		viaProxy: boolean,
		proxyHost: string | null,
	): void {
		const payload = {
			event: 'api_connection_proxy_checked',
			id,
			name,
			status,
			viaProxy,
			proxyHost,
		};
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'api_connection_proxy_checked',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata: { name, status, viaProxy, proxyHost },
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
