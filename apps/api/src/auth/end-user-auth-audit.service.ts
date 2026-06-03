import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../audit/audit-persistence.service';

type LoginFailureReason = 'invalid_credentials' | 'inactive' | 'unsupported_algorithm';

@Injectable()
export class EndUserAuthAuditService {
	private readonly logger = new Logger(EndUserAuthAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	logLoginSuccess(
		userId: string,
		username: string,
		clientIp: string,
		samlSessionBound: boolean,
	): void {
		const payload = {
			event: 'end_user_login_success',
			userId,
			username,
			clientIp,
			samlSessionBound,
		};
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'end_user_auth',
			event: 'end_user_login_success',
			actorType: 'end_user',
			actorId: userId,
			actorLabel: username,
			clientIp,
			metadata: { samlSessionBound },
		});
	}

	logLoginFailure(username: string, clientIp: string, reason: LoginFailureReason): void {
		const payload = { event: 'end_user_login_failure', username, clientIp, reason };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'end_user_auth',
			event: 'end_user_login_failure',
			actorType: 'end_user',
			actorLabel: username,
			clientIp,
			metadata: { reason },
		});
	}

	logSamlBindFailure(samlSessionId: string, clientIp: string, reason: string): void {
		const payload = { event: 'end_user_saml_bind_failure', samlSessionId, clientIp, reason };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'end_user_auth',
			event: 'end_user_saml_bind_failure',
			actorType: 'end_user',
			clientIp,
			subjectType: 'SamlSession',
			subjectId: samlSessionId,
			metadata: { reason },
		});
	}

	logLogout(userId: string, clientIp: string): void {
		const payload = { event: 'end_user_logout', userId, clientIp };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'end_user_auth',
			event: 'end_user_logout',
			actorType: 'end_user',
			actorId: userId,
			clientIp,
		});
	}

	logUnsupportedAlgorithm(userId: string): void {
		const payload = { event: 'end_user_unsupported_hash_algorithm', userId };
		this.logger.warn(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'end_user_auth',
			event: 'end_user_unsupported_hash_algorithm',
			actorType: 'end_user',
			actorId: userId,
		});
	}

	logSsoCompleteSuccess(samlSessionId: string, userId: string, clientIp: string): void {
		const payload = { event: 'end_user_sso_complete_success', samlSessionId, userId, clientIp };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'end_user_auth',
			event: 'end_user_sso_complete_success',
			actorType: 'end_user',
			actorId: userId,
			clientIp,
			subjectType: 'SamlSession',
			subjectId: samlSessionId,
		});
	}

	logSsoCompleteFailure(samlSessionId: string, clientIp: string, reason: string): void {
		const payload = { event: 'end_user_sso_complete_failure', samlSessionId, clientIp, reason };
		this.logger.warn(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'end_user_auth',
			event: 'end_user_sso_complete_failure',
			actorType: 'end_user',
			clientIp,
			subjectType: 'SamlSession',
			subjectId: samlSessionId,
			metadata: { reason },
		});
	}
}
