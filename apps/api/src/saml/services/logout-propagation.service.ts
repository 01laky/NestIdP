import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LogoutPropagationInput, LogoutPropagationPort } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import type { AuditEventName } from '../../audit/audit-event-names';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { redactSecrets } from '../../encryption/utils/redact-secret.util';
import { errorMessage as messageOf } from '../../common/utils/error-message.util';
import { BackchannelLogoutConfig } from './backchannel-logout.config';
import { IdpSigningService } from './idp-signing.service';
import { SamlLogoutRequestBuilderService } from './saml-logout-request-builder.service';
import {
	SamlSoapBackchannelService,
	type SoapDeliveryOutcome,
} from './saml-soap-backchannel.service';
import {
	LOGOUT_PROPAGATION_NOTIFIER,
	type LogoutPropagationNotifier,
} from './logout-propagation-notifier';

interface QueueRow {
	id: string;
	ssoSessionId: string;
	spConnectionId: string;
	sessionIndex: string;
	nameId: string;
	nameIdFormat: string;
	reason: string;
	attempts: number;
	requestId: string | null;
}

/**
 * Back-channel (SOAP) SLO propagation engine (Prompt 36) — the real `LogoutPropagationPort`. On each
 * terminate it enqueues a delivery per participating SP (dedup by session×SP), then runs a time-boxed
 * fire-and-forget first pass; the scheduler retries the rest. Logout is authoritative locally — this never
 * blocks the caller and never throws out.
 */
@Injectable()
export class LogoutPropagationService implements LogoutPropagationPort {
	private readonly logger = new Logger('LogoutPropagation');

	constructor(
		private readonly prisma: PrismaService,
		private readonly config: BackchannelLogoutConfig,
		private readonly builder: SamlLogoutRequestBuilderService,
		private readonly signing: IdpSigningService,
		private readonly soap: SamlSoapBackchannelService,
		private readonly audit: AuditPersistenceService,
		@Inject(LOGOUT_PROPAGATION_NOTIFIER) private readonly notifier: LogoutPropagationNotifier,
	) {}

	/** Enqueue propagation for a terminated session, then kick a fire-and-forget first pass. Never throws. */
	async propagateLogout(input: LogoutPropagationInput): Promise<void> {
		try {
			const participations = await this.prisma.samlSpParticipation.findMany({
				where: { ssoSessionId: input.ssoSessionId },
				include: { spConnection: true },
			});
			const now = new Date();
			for (const p of participations) {
				if (input.excludeSpConnectionId && p.spConnectionId === input.excludeSpConnectionId) {
					continue;
				}
				const sp = p.spConnection;
				if (!sp.active) {
					continue;
				}
				const skipped = !sp.sloSoapUrl;
				await this.prisma.samlBackchannelLogout
					.upsert({
						where: {
							ssoSessionId_spConnectionId: {
								ssoSessionId: input.ssoSessionId,
								spConnectionId: p.spConnectionId,
							},
						},
						create: {
							ssoSessionId: input.ssoSessionId,
							spConnectionId: p.spConnectionId,
							sessionIndex: p.sessionIndex,
							nameId: p.nameId,
							nameIdFormat: p.nameIdFormat,
							reason: input.reason,
							status: skipped ? 'skipped_no_endpoint' : 'pending',
							requestId: skipped ? null : `_${randomBytes(16).toString('hex')}`,
							nextRetryAt: skipped ? null : now,
						},
						// Dedup: an existing row (session×SP) is left as-is — never re-enqueued.
						update: {},
					})
					.catch(() => undefined);
				if (skipped) {
					this.recordAudit(
						'saml_backchannel_logout_skipped',
						p.spConnectionId,
						sp.spEntityId,
						input.reason,
						0,
					);
				}
			}
			// fire-and-forget; the caller's HTTP response is never blocked by SP delivery
			void this.runFirstPass();
		} catch (error) {
			this.logger.warn(
				JSON.stringify({ event: 'backchannel_logout_enqueue_failed', message: messageOf(error) }),
			);
		}
	}

	/** Time-boxed synchronous-ish first pass; the remainder falls to the retry scheduler. */
	private async runFirstPass(): Promise<void> {
		const deadline = Date.now() + this.config.firstPassBudgetMs();
		try {
			while (Date.now() < deadline) {
				const processed = await this.processDue();
				if (processed === 0) {
					break;
				}
			}
		} catch (error) {
			this.logger.warn(
				JSON.stringify({
					event: 'backchannel_logout_first_pass_failed',
					message: messageOf(error),
				}),
			);
		}
	}

	/** Pick due rows (bounded by concurrency + global in-flight cap) and deliver them. Returns count tried. */
	async processDue(now: Date = new Date()): Promise<number> {
		const inFlight = await this.prisma.samlBackchannelLogout.count({
			where: { status: 'in_flight' },
		});
		const budget = this.config.maxInFlight() - inFlight;
		if (budget <= 0) {
			return 0;
		}
		const due = (await this.prisma.samlBackchannelLogout.findMany({
			where: { status: { in: ['pending', 'failed'] }, nextRetryAt: { lte: now } },
			orderBy: { nextRetryAt: 'asc' },
			take: Math.min(this.config.concurrency(), budget),
		})) as QueueRow[];
		await Promise.all(due.map((row) => this.deliverRow(row).catch(() => undefined)));
		return due.length;
	}

	/** Reset a delivery to pending so it is retried on the next pass (operator "resend"). */
	async resend(ssoSessionId: string, spConnectionId: string): Promise<void> {
		await this.prisma.samlBackchannelLogout.updateMany({
			where: { ssoSessionId, spConnectionId, status: { in: ['failed', 'given_up', 'partial'] } },
			// §5.B2: reset attempts on an operator resend — otherwise a resent given-up row immediately
			// re-exceeds maxRetries on its next failure and gives up again after a single try.
			data: { status: 'pending', attempts: 0, nextRetryAt: new Date() },
		});
		void this.runFirstPass();
	}

	/**
	 * Operator "Test back-channel SLO" probe (Prompt 36, item S): build + sign a throwaway LogoutRequest
	 * and deliver it to the SP's SOAP endpoint, reporting reachability / signature acceptance. Never
	 * enqueues, never mutates a session — a pure validation of the configured endpoint. Never throws.
	 */
	async probe(spConnectionId: string): Promise<{ ok: boolean; reason?: string }> {
		try {
			const sp = await this.prisma.spConnection.findUnique({ where: { id: spConnectionId } });
			if (!sp?.sloSoapUrl) {
				return { ok: false, reason: 'no_soap_endpoint' };
			}
			const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
			if (!settings?.entityId) {
				return { ok: false, reason: 'idp_not_configured' };
			}
			const requestId = `_probe-${randomBytes(16).toString('hex')}`;
			const material = await this.signing.ensureSigningMaterial();
			const built = this.builder.build({
				requestId,
				destination: sp.sloSoapUrl,
				idpEntityId: settings.entityId,
				nameId: 'urn:nestidp:backchannel:probe',
				nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:unspecified',
				sessionIndexes: ['_probe'],
				validitySeconds: this.config.validitySeconds(),
			});
			const signed = this.signing.signLogoutRequest(built.xml, material, requestId);
			const result = await this.soap.deliver({
				soapUrl: sp.sloSoapUrl,
				signedLogoutRequestXml: signed,
				requestId,
				spCertificate: sp.spCertificate,
				timeoutMs: this.config.httpTimeoutMs(),
				clockSkewSeconds: this.config.clockSkewSeconds(),
			});
			return {
				ok: result.outcome === 'succeeded' || result.outcome === 'partial',
				reason: result.reason,
			};
		} catch (error) {
			return { ok: false, reason: redactSecrets(messageOf(error)) };
		}
	}

	/** Periodic prune of resolved rows older than the retention window. Returns rows removed. */
	async prune(now: Date = new Date()): Promise<number> {
		const cutoff = new Date(now.getTime() - this.config.pruneRetentionMs());
		const result = await this.prisma.samlBackchannelLogout.deleteMany({
			where: {
				// §5.B2: include 'partial' — it is a terminal status (the SP responded with PartialLogout;
				// re-sending won't change that, and an operator can still resend manually). Previously it
				// was neither retried by processDue nor pruned here, so partial rows accumulated forever.
				status: { in: ['succeeded', 'given_up', 'skipped_no_endpoint', 'partial'] },
				updatedAt: { lt: cutoff },
			},
		});
		return result.count;
	}

	private async deliverRow(row: QueueRow): Promise<void> {
		const now = new Date();
		// Atomic claim — only one worker processes a row (per-SP serialization + no double-send).
		const claimed = await this.prisma.samlBackchannelLogout.updateMany({
			where: { id: row.id, status: { in: ['pending', 'failed'] } },
			data: { status: 'in_flight', lastAttemptAt: now },
		});
		if (claimed.count === 0) {
			return;
		}

		const sp = await this.prisma.spConnection.findUnique({ where: { id: row.spConnectionId } });
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		const attempts = row.attempts + 1;
		const requestId = row.requestId ?? `_${randomBytes(16).toString('hex')}`;

		if (!sp?.sloSoapUrl || !settings?.entityId) {
			await this.finishFailure(row, attempts, 'no_endpoint_or_idp', sp?.spEntityId);
			return;
		}

		try {
			const material = await this.signing.ensureSigningMaterial();
			const built = this.builder.build({
				requestId,
				destination: sp.sloSoapUrl,
				idpEntityId: settings.entityId,
				nameId: row.nameId,
				nameIdFormat: row.nameIdFormat,
				sessionIndexes: [row.sessionIndex],
				validitySeconds: this.config.validitySeconds(),
			});
			const signed = this.signing.signLogoutRequest(built.xml, material, requestId);
			this.recordAudit(
				'saml_backchannel_logout_sent',
				row.spConnectionId,
				sp.spEntityId,
				row.reason,
				attempts,
			);
			this.notifySafe(() => this.notifier.onSent(this.notification(row, sp.spEntityId, attempts)));

			const result = await this.soap.deliver({
				soapUrl: sp.sloSoapUrl,
				signedLogoutRequestXml: signed,
				requestId,
				spCertificate: sp.spCertificate,
				timeoutMs: this.config.httpTimeoutMs(),
				clockSkewSeconds: this.config.clockSkewSeconds(),
			});

			if (result.outcome === 'succeeded' || result.outcome === 'partial') {
				await this.finishResolved(row, attempts, requestId, result.outcome, sp.spEntityId);
			} else {
				await this.finishFailure(
					row,
					attempts,
					result.reason ?? 'failed',
					sp.spEntityId,
					requestId,
				);
			}
		} catch (error) {
			await this.finishFailure(
				row,
				attempts,
				redactSecrets(messageOf(error)),
				sp.spEntityId,
				requestId,
			);
		}
	}

	private async finishResolved(
		row: QueueRow,
		attempts: number,
		requestId: string,
		outcome: Extract<SoapDeliveryOutcome, 'succeeded' | 'partial'>,
		spEntityId?: string,
	): Promise<void> {
		await this.prisma.samlBackchannelLogout.update({
			where: { id: row.id },
			data: { status: outcome, attempts, requestId, lastError: null, nextRetryAt: null },
		});
		await this.updateSpStatus(row.spConnectionId, outcome);
		const event =
			outcome === 'partial'
				? 'saml_backchannel_logout_partial'
				: 'saml_backchannel_logout_succeeded';
		this.recordAudit(event, row.spConnectionId, spEntityId, row.reason, attempts);
		this.notifySafe(() => this.notifier.onSucceeded(this.notification(row, spEntityId, attempts)));
	}

	private async finishFailure(
		row: QueueRow,
		attempts: number,
		reason: string,
		spEntityId?: string,
		requestId?: string,
	): Promise<void> {
		const givenUp = attempts > this.config.maxRetries();
		if (givenUp) {
			await this.prisma.samlBackchannelLogout.update({
				where: { id: row.id },
				data: { status: 'given_up', attempts, lastError: reason, nextRetryAt: null, requestId },
			});
			await this.updateSpStatus(row.spConnectionId, 'given_up');
			this.recordAudit(
				'saml_backchannel_logout_given_up',
				row.spConnectionId,
				spEntityId,
				row.reason,
				attempts,
				reason,
			);
			this.notifySafe(() =>
				this.notifier.onGivenUp(this.notification(row, spEntityId, attempts, reason)),
			);
			return;
		}
		const backoff = Math.min(
			this.config.retryMaxMs(),
			this.config.retryBaseMs() * 2 ** (attempts - 1),
		);
		// §5.B2: add jitter (50–100% of the computed backoff) so a mass termination that fails against a
		// down SP doesn't produce a synchronized retry thundering-herd against that SP.
		const jittered = Math.round(backoff / 2 + Math.random() * (backoff / 2));
		await this.prisma.samlBackchannelLogout.update({
			where: { id: row.id },
			data: {
				status: 'failed',
				attempts,
				lastError: reason,
				requestId,
				nextRetryAt: new Date(Date.now() + jittered),
			},
		});
		await this.updateSpStatus(row.spConnectionId, 'failed');
		this.recordAudit(
			'saml_backchannel_logout_failed',
			row.spConnectionId,
			spEntityId,
			row.reason,
			attempts,
			reason,
		);
		this.notifySafe(() =>
			this.notifier.onFailed(this.notification(row, spEntityId, attempts, reason)),
		);
	}

	private async updateSpStatus(spConnectionId: string, status: string): Promise<void> {
		await this.prisma.spConnection
			.update({
				where: { id: spConnectionId },
				data: { lastBackchannelLogoutStatus: status, lastBackchannelLogoutAt: new Date() },
			})
			.catch(() => undefined);
	}

	private notification(
		row: QueueRow,
		spEntityId: string | undefined,
		attempts: number,
		error?: string,
	) {
		return {
			ssoSessionId: row.ssoSessionId,
			spConnectionId: row.spConnectionId,
			spEntityId,
			reason: row.reason,
			attempts,
			error,
		};
	}

	/**
	 * Notifier hooks are best-effort observers: a sync throw must not abort/corrupt the delivery
	 * state machine (an onSucceeded throw previously flipped an already-succeeded row to failed via
	 * the caller's catch), and an async rejection must not become an unhandled rejection.
	 */
	private notifySafe(notify: () => Promise<void> | void): void {
		try {
			Promise.resolve(notify()).catch((error) => {
				this.logger.warn(
					JSON.stringify({ event: 'backchannel_notifier_error', message: messageOf(error) }),
				);
			});
		} catch (error) {
			this.logger.warn(
				JSON.stringify({ event: 'backchannel_notifier_error', message: messageOf(error) }),
			);
		}
	}

	private recordAudit(
		event: AuditEventName,
		spConnectionId: string,
		spEntityId: string | undefined,
		reason: string,
		attempts: number,
		error?: string,
	): void {
		this.audit.recordSafe({
			category: 'saml',
			event,
			actorType: 'system',
			subjectType: 'SpConnection',
			subjectId: spConnectionId,
			metadata: { spEntityId, reason, attempts, ...(error ? { error } : {}) },
		});
		this.logger.log(
			JSON.stringify({
				event,
				spConnectionId,
				spEntityId,
				reason,
				attempts,
				...(error ? { error } : {}),
			}),
		);
	}
}
