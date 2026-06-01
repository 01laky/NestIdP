import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SamlAuthAuditService {
	private readonly logger = new Logger(SamlAuthAuditService.name);

	logRequestReceived(payload: {
		spEntityId: string;
		samlRequestId: string;
		spConnectionId: string;
		clientIp: string;
	}): void {
		this.logger.log(
			JSON.stringify({
				event: 'saml_request_received',
				...payload,
			}),
		);
	}

	logRequestRejected(reason: string, clientIp: string): void {
		this.logger.warn(
			JSON.stringify({
				event: 'saml_request_rejected',
				reason,
				clientIp,
			}),
		);
	}

	logResponseIssued(payload: { samlSessionId: string; userId: string; spEntityId: string }): void {
		this.logger.log(
			JSON.stringify({
				event: 'saml_response_issued',
				...payload,
			}),
		);
	}

	logResponseFailed(samlSessionId: string, reason: string): void {
		this.logger.warn(
			JSON.stringify({
				event: 'saml_response_failed',
				samlSessionId,
				reason,
			}),
		);
	}

	logSigningKeyGenerated(): void {
		this.logger.log(JSON.stringify({ event: 'idp_signing_key_generated' }));
	}
}
