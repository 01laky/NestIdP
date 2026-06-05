import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';

@Injectable()
export class SamlAuthAuditService {
	private readonly logger = new Logger(SamlAuthAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	logRequestReceived(payload: {
		spEntityId: string;
		samlRequestId: string;
		spConnectionId: string;
		clientIp: string;
	}): void {
		const eventPayload = { event: 'saml_request_received', ...payload };
		this.logger.log(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_request_received',
			actorType: 'system',
			clientIp: payload.clientIp,
			subjectType: 'SpConnection',
			subjectId: payload.spConnectionId,
			metadata: {
				spEntityId: payload.spEntityId,
				samlRequestId: payload.samlRequestId,
			},
		});
	}

	logRequestRejected(reason: string, clientIp: string): void {
		const eventPayload = { event: 'saml_request_rejected', reason, clientIp };
		this.logger.warn(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_request_rejected',
			actorType: 'system',
			clientIp,
			metadata: { reason },
		});
	}

	logResponseIssued(payload: { samlSessionId: string; userId: string; spEntityId: string }): void {
		const eventPayload = { event: 'saml_response_issued', ...payload };
		this.logger.log(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_response_issued',
			actorType: 'end_user',
			actorId: payload.userId,
			subjectType: 'SamlSession',
			subjectId: payload.samlSessionId,
			metadata: { spEntityId: payload.spEntityId },
		});
	}

	logResponseFailed(samlSessionId: string, reason: string): void {
		const eventPayload = { event: 'saml_response_failed', samlSessionId, reason };
		this.logger.warn(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_response_failed',
			actorType: 'system',
			subjectType: 'SamlSession',
			subjectId: samlSessionId,
			metadata: { reason },
		});
	}

	logSigningKeyGenerated(): void {
		const eventPayload = { event: 'idp_signing_key_generated' };
		this.logger.log(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_signing_key_generated',
			actorType: 'system',
			subjectType: 'IdpSettings',
			subjectId: 'default',
		});
	}
}
