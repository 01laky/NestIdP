import { Injectable } from '@nestjs/common';

/** DI token for the scheduled-sync failure notifier (extensible; default is a no-op). */
export const SCHEDULED_SYNC_NOTIFIER = Symbol('SCHEDULED_SYNC_NOTIFIER');

/** Details handed to the notifier when a scheduled run fails or the schedule is auto-paused. */
export interface ScheduledSyncFailureEvent {
	connectionId: string;
	connectionName: string;
	consecutiveFailures: number;
	autoPaused: boolean;
	message: string;
	syncLogId?: string;
}

/**
 * Extension point for delivering scheduled-sync failure notifications (email/webhook/etc).
 * The scheduler depends only on this interface so a future implementation can be wired without
 * touching the scheduler. Delivery is intentionally NOT implemented in Prompt 32.
 */
export interface ScheduledSyncNotifier {
	notifyFailure(event: ScheduledSyncFailureEvent): void;
}

/** Default no-op notifier: the hook point exists, but nothing is delivered. */
@Injectable()
export class NoopScheduledSyncNotifier implements ScheduledSyncNotifier {
	notifyFailure(): void {
		// Intentionally empty — delivery is a future extension (Prompt 32, deliverable 18).
	}
}
