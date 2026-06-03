import { Injectable } from '@nestjs/common';
import { AuditPersistenceService } from '../audit/audit-persistence.service';

@Injectable()
export class AdminAuthAuditService {
	constructor(private readonly audit: AuditPersistenceService) {}

	logLoginSuccess(adminId: string, username: string, clientIp: string): void {
		this.audit.recordSafe({
			category: 'admin_auth',
			event: 'admin_login_success',
			actorType: 'admin',
			actorId: adminId,
			actorLabel: username,
			clientIp,
		});
	}

	logLoginFailure(username: string, clientIp: string): void {
		this.audit.recordSafe({
			category: 'admin_auth',
			event: 'admin_login_failure',
			actorType: 'admin',
			actorLabel: username,
			clientIp,
		});
	}

	logLogout(adminId: string, username: string, clientIp: string): void {
		this.audit.recordSafe({
			category: 'admin_auth',
			event: 'admin_logout',
			actorType: 'admin',
			actorId: adminId,
			actorLabel: username,
			clientIp,
		});
	}

	logPasswordChanged(adminId: string, username: string, clientIp: string): void {
		this.audit.recordSafe({
			category: 'admin_auth',
			event: 'admin_password_changed',
			actorType: 'admin',
			actorId: adminId,
			actorLabel: username,
			clientIp,
		});
	}
}
