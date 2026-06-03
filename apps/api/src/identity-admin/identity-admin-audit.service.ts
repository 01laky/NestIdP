import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../audit/audit-persistence.service';

@Injectable()
export class IdentityAdminAuditService {
	private readonly logger = new Logger(IdentityAdminAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	logUserCreated(id: string, username: string): void {
		this.record('identity.user.created', 'user', id, { username });
	}

	logUserUpdated(id: string, username: string): void {
		this.record('identity.user.updated', 'user', id, { username });
	}

	logUserDeleted(id: string, username: string): void {
		this.record('identity.user.deleted', 'user', id, { username });
	}

	logGroupCreated(id: string, name: string): void {
		this.record('identity.group.created', 'group', id, { name });
	}

	logGroupUpdated(id: string, name: string): void {
		this.record('identity.group.updated', 'group', id, { name });
	}

	logGroupDeleted(id: string, name: string): void {
		this.record('identity.group.deleted', 'group', id, { name });
	}

	logRoleCreated(id: string, name: string): void {
		this.record('identity.role.created', 'role', id, { name });
	}

	logRoleUpdated(id: string, name: string): void {
		this.record('identity.role.updated', 'role', id, { name });
	}

	logRoleDeleted(id: string, name: string): void {
		this.record('identity.role.deleted', 'role', id, { name });
	}

	private record(
		event: string,
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
