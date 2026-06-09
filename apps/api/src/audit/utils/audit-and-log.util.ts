import type { Logger } from '@nestjs/common';
import type {
	AuditPersistenceService,
	AuditRecordInput,
} from '../services/audit-persistence.service';

/**
 * Shared "emit a structured log line + persist an audit row" used by the per-domain audit services
 * (Prompt 38 §6.2 / §A3). Replaces the `this.logger.log(JSON.stringify({event, id, ...})) ; recordSafe(...)`
 * pair that was hand-copied in every method of every audit service. The constant fields
 * (category / actorType / subjectType) stay with each caller.
 *
 * Behaviour-preserving: it reproduces the previous per-service stdout line exactly (`{event, id, ...metadata}`)
 * AND calls recordSafe (which itself logs its own envelope + persists). Collapsing that intentional
 * double-emit to a single channel is a separate, riskier change left as a follow-up.
 */
export function recordAndLog(
	audit: AuditPersistenceService,
	logger: Logger,
	input: AuditRecordInput,
): void {
	logger.log(
		JSON.stringify({ event: input.event, id: input.subjectId, ...(input.metadata ?? {}) }),
	);
	audit.recordSafe(input);
}
