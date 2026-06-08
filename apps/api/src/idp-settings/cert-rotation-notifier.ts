import { Logger } from '@nestjs/common';

export const CERT_ROTATION_NOTIFIER = Symbol('CERT_ROTATION_NOTIFIER');

export type CertRotationKind = 'signing' | 'encryption';

/** Non-secret payload for a cert-rotation lifecycle notification (never carries key material). */
export interface CertRotationNotification {
	kind: CertRotationKind;
	activeCertNotAfter?: string | null;
	pendingCertNotAfter?: string | null;
	willAutoCompleteAt?: string | null;
	/** True when the scheduler is in dry-run mode (the action was simulated, not applied). */
	dryRun?: boolean;
	/** Redacted failure reason (failure notifications only). */
	reason?: string;
}

/**
 * Hook invoked by the automatic certificate-rotation scheduler (Prompt 34). The default
 * implementation is a no-op logger; a deployment can provide its own (email / Slack / webhook) without
 * touching the scheduler. Mirrors {@link ScheduledSyncNotifier}.
 */
export interface CertRotationNotifier {
	/** Fired ahead of the auto-start window so an operator has time to intervene. */
	onAutoRotationDueSoon(n: CertRotationNotification): Promise<void> | void;
	onAutoRotationStarted(n: CertRotationNotification): Promise<void> | void;
	onAutoRotationCompleted(n: CertRotationNotification): Promise<void> | void;
	onAutoRotationFailed(n: CertRotationNotification): Promise<void> | void;
}

export class NoopCertRotationNotifier implements CertRotationNotifier {
	private readonly logger = new Logger('CertRotationNotifier');

	onAutoRotationDueSoon(n: CertRotationNotification): void {
		this.logger.log(JSON.stringify({ event: 'cert_rotation_due_soon', ...n }));
	}
	onAutoRotationStarted(n: CertRotationNotification): void {
		this.logger.log(JSON.stringify({ event: 'cert_rotation_auto_started', ...n }));
	}
	onAutoRotationCompleted(n: CertRotationNotification): void {
		this.logger.log(JSON.stringify({ event: 'cert_rotation_auto_completed', ...n }));
	}
	onAutoRotationFailed(n: CertRotationNotification): void {
		this.logger.warn(JSON.stringify({ event: 'cert_rotation_auto_failed', ...n }));
	}
}
