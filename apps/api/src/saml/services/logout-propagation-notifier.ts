import { Logger } from '@nestjs/common';

export const LOGOUT_PROPAGATION_NOTIFIER = Symbol('LOGOUT_PROPAGATION_NOTIFIER');

/** Non-secret payload for a back-channel logout notification (never carries assertions or keys). */
export interface LogoutPropagationNotification {
	ssoSessionId: string;
	spConnectionId: string;
	spEntityId?: string;
	reason: string;
	attempts: number;
	/** Redacted failure reason (failed / given-up only). */
	error?: string;
}

/**
 * Hook invoked by the back-channel SLO engine (Prompt 36) on each delivery lifecycle transition. The
 * default implementation is a no-op structured logger; a deployment can provide its own (alert when an SP
 * repeatedly refuses logout — the user is still logged in there). Mirrors {@link CertRotationNotifier}.
 */
export interface LogoutPropagationNotifier {
	onSent(n: LogoutPropagationNotification): Promise<void> | void;
	onSucceeded(n: LogoutPropagationNotification): Promise<void> | void;
	onFailed(n: LogoutPropagationNotification): Promise<void> | void;
	onGivenUp(n: LogoutPropagationNotification): Promise<void> | void;
}

export class NoopLogoutPropagationNotifier implements LogoutPropagationNotifier {
	private readonly logger = new Logger('LogoutPropagationNotifier');

	onSent(n: LogoutPropagationNotification): void {
		this.logger.log(JSON.stringify({ event: 'backchannel_logout_sent', ...n }));
	}
	onSucceeded(n: LogoutPropagationNotification): void {
		this.logger.log(JSON.stringify({ event: 'backchannel_logout_succeeded', ...n }));
	}
	onFailed(n: LogoutPropagationNotification): void {
		this.logger.warn(JSON.stringify({ event: 'backchannel_logout_failed', ...n }));
	}
	onGivenUp(n: LogoutPropagationNotification): void {
		this.logger.warn(JSON.stringify({ event: 'backchannel_logout_given_up', ...n }));
	}
}
