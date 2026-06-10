import { Injectable, Logger } from '@nestjs/common';
import type { AuditEventName } from '../../audit/audit-event-names';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { recordAndLog } from '../../audit/utils/audit-and-log.util';

@Injectable()
export class ApiConnectionsAuditService {
	private readonly logger = new Logger(ApiConnectionsAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	private record(event: AuditEventName, id: string, metadata: Record<string, unknown>): void {
		recordAndLog(this.audit, this.logger, {
			category: 'admin_config',
			event,
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: id,
			metadata,
		});
	}

	logCreated(id: string, name: string): void {
		this.record('api_connection_created', id, { name });
	}

	logUpdated(id: string, name: string): void {
		this.record('api_connection_updated', id, { name });
	}

	logContractUpdated(id: string, name: string, customizedSections: string[]): void {
		this.record('api_connection_contract_updated', id, { name, customizedSections });
	}

	logAuthTypeChanged(id: string, name: string, authType: string): void {
		this.record('api_connection_auth_type_changed', id, { name, authType });
	}

	logDeleted(id: string, name: string): void {
		this.record('api_connection_deleted', id, { name });
	}

	/** A sync source's identities were removed (Prompt 37). */
	logSourceIdentitiesRemoved(
		id: string,
		name: string,
		mode: 'deactivate' | 'delete',
		counts: { usersRemoved: number; groupsRemoved: number; rolesRemoved: number },
	): void {
		this.record('identity_source_identities_removed', id, { name, mode, ...counts });
	}

	logProxyUpdated(
		id: string,
		name: string,
		detail: { enabled: boolean; proxyHost: string | null; hasAuth: boolean; hasNoProxy: boolean },
	): void {
		this.record('api_connection_proxy_updated', id, { name, ...detail });
	}

	logProxyChecked(
		id: string,
		name: string,
		status: string,
		viaProxy: boolean,
		proxyHost: string | null,
	): void {
		this.record('api_connection_proxy_checked', id, { name, status, viaProxy, proxyHost });
	}

	logTested(id: string, reachable: boolean, statusCode?: number): void {
		this.record('api_connection_tested', id, { reachable, statusCode: statusCode ?? null });
	}
}
