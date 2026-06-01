import { Injectable, Logger } from '@nestjs/common';

type LoginFailureReason = 'invalid_credentials' | 'inactive' | 'unsupported_algorithm';

@Injectable()
export class EndUserAuthAuditService {
	private readonly logger = new Logger(EndUserAuthAuditService.name);

	logLoginSuccess(
		userId: string,
		username: string,
		clientIp: string,
		samlSessionBound: boolean,
	): void {
		this.logger.log(
			JSON.stringify({
				event: 'end_user_login_success',
				userId,
				username,
				clientIp,
				samlSessionBound,
			}),
		);
	}

	logLoginFailure(username: string, clientIp: string, reason: LoginFailureReason): void {
		this.logger.log(
			JSON.stringify({
				event: 'end_user_login_failure',
				username,
				clientIp,
				reason,
			}),
		);
	}

	logSamlBindFailure(samlSessionId: string, clientIp: string, reason: string): void {
		this.logger.log(
			JSON.stringify({
				event: 'end_user_saml_bind_failure',
				samlSessionId,
				clientIp,
				reason,
			}),
		);
	}

	logLogout(userId: string, clientIp: string): void {
		this.logger.log(
			JSON.stringify({
				event: 'end_user_logout',
				userId,
				clientIp,
			}),
		);
	}

	logUnsupportedAlgorithm(userId: string): void {
		this.logger.warn(
			JSON.stringify({
				event: 'end_user_unsupported_hash_algorithm',
				userId,
			}),
		);
	}
}
