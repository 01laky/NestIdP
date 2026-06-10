import { Injectable, Logger } from '@nestjs/common';
import type { AuditEventName } from '../../audit/audit-event-names';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';

@Injectable()
export class IdentityAdminAuditService {
	private readonly logger = new Logger(IdentityAdminAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	logUserCreated(id: string, username: string): void {
		this.record('identity_user_created', 'user', id, { username });
	}

	logUserUpdated(id: string, username: string): void {
		this.record('identity_user_updated', 'user', id, { username });
	}

	logUserDeleted(id: string, username: string): void {
		this.record('identity_user_deleted', 'user', id, { username });
	}

	logGroupCreated(id: string, name: string): void {
		this.record('identity_group_created', 'group', id, { name });
	}

	logGroupUpdated(id: string, name: string): void {
		this.record('identity_group_updated', 'group', id, { name });
	}

	logGroupDeleted(id: string, name: string): void {
		this.record('identity_group_deleted', 'group', id, { name });
	}

	logRoleCreated(id: string, name: string): void {
		this.record('identity_role_created', 'role', id, { name });
	}

	logRoleUpdated(id: string, name: string): void {
		this.record('identity_role_updated', 'role', id, { name });
	}

	logRoleDeleted(id: string, name: string): void {
		this.record('identity_role_deleted', 'role', id, { name });
	}

	private record(
		event: AuditEventName,
		subjectType: string,
		subjectId: string,
		metadata: Record<string, string>,
	): void {
		this.logger.log(JSON.stringify({ event, subjectType, subjectId, ...metadata }));
		this.audit.recordSafe({
			category: 'identity',
			event,
			actorType: 'admin',
			subjectType,
			subjectId,
			metadata,
		});
	}
}
