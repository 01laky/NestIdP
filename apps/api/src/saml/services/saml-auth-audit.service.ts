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
		requestWasSigned: boolean;
		requestWasEncrypted: boolean;
		sigAlgUri?: string;
		bindingType?: 'redirect' | 'post';
	}): void {
		const { sigAlgUri, bindingType, ...rest } = payload;
		const eventPayload = { event: 'saml_request_received', ...rest, sigAlgUri, bindingType };
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
				requestWasSigned: payload.requestWasSigned,
				requestWasEncrypted: payload.requestWasEncrypted,
				...(sigAlgUri ? { sigAlgUri } : {}),
				...(bindingType ? { bindingType } : {}),
			},
		});
	}

	logRequestSignatureVerified(payload: {
		spEntityId: string;
		samlRequestId: string;
		spConnectionId: string;
		sigAlgUri: string;
	}): void {
		const eventPayload = { event: 'saml_request_signature_verified', ...payload };
		this.logger.log(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_request_signature_verified',
			actorType: 'system',
			subjectType: 'SpConnection',
			subjectId: payload.spConnectionId,
			metadata: {
				spEntityId: payload.spEntityId,
				samlRequestId: payload.samlRequestId,
				sigAlgUri: payload.sigAlgUri,
			},
		});
	}

	logRequestDecrypted(payload: {
		spEntityId: string;
		samlRequestId: string;
		spConnectionId: string;
	}): void {
		const eventPayload = { event: 'saml_request_decrypted', ...payload };
		this.logger.log(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_request_decrypted',
			actorType: 'system',
			subjectType: 'SpConnection',
			subjectId: payload.spConnectionId,
			metadata: {
				spEntityId: payload.spEntityId,
				samlRequestId: payload.samlRequestId,
			},
		});
	}

	logRequestRejected(reason: string, clientIp: string, bindingType?: 'redirect' | 'post'): void {
		const eventPayload = {
			event: 'saml_request_rejected',
			reason,
			clientIp,
			...(bindingType ? { bindingType } : {}),
		};
		this.logger.warn(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_request_rejected',
			actorType: 'system',
			clientIp,
			metadata: { reason, ...(bindingType ? { bindingType } : {}) },
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

	logLogoutRequestReceived(payload: {
		spEntityId: string;
		logoutRequestId: string;
		spConnectionId: string;
		clientIp: string;
		bindingType: 'redirect' | 'post';
		requestWasSigned: boolean;
	}): void {
		const eventPayload = { event: 'saml_logout_request_received', ...payload };
		this.logger.log(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_logout_request_received',
			actorType: 'system',
			clientIp: payload.clientIp,
			subjectType: 'SpConnection',
			subjectId: payload.spConnectionId,
			metadata: {
				spEntityId: payload.spEntityId,
				logoutRequestId: payload.logoutRequestId,
				bindingType: payload.bindingType,
				requestWasSigned: payload.requestWasSigned,
			},
		});
	}

	logLogoutRequestRejected(
		reason: string,
		clientIp: string,
		bindingType?: 'redirect' | 'post',
	): void {
		const eventPayload = {
			event: 'saml_logout_request_rejected',
			reason,
			clientIp,
			...(bindingType ? { bindingType } : {}),
		};
		this.logger.warn(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_logout_request_rejected',
			actorType: 'system',
			clientIp,
			metadata: { reason, ...(bindingType ? { bindingType } : {}) },
		});
	}

	logLogoutCompleted(payload: {
		spEntityId: string;
		spConnectionId: string;
		bindingType: 'redirect' | 'post';
		responseDelivered: boolean;
		sessionTerminated: boolean;
	}): void {
		const eventPayload = { event: 'saml_logout_completed', ...payload };
		this.logger.log(JSON.stringify(eventPayload));
		this.audit.recordSafe({
			category: 'saml',
			event: 'saml_logout_completed',
			actorType: 'system',
			subjectType: 'SpConnection',
			subjectId: payload.spConnectionId,
			metadata: {
				spEntityId: payload.spEntityId,
				bindingType: payload.bindingType,
				responseDelivered: payload.responseDelivered,
				sessionTerminated: payload.sessionTerminated,
			},
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
