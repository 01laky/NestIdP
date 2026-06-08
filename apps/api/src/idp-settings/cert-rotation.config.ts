import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	CERT_ROTATION_DEFAULT_FAILURE_AUTODISABLE_THRESHOLD,
	CERT_ROTATION_DEFAULT_LEAD_DAYS,
	CERT_ROTATION_DEFAULT_NOTIFY_LEAD_DAYS,
	CERT_ROTATION_DEFAULT_OVERLAP_DAYS,
	CERT_ROTATION_DEFAULT_VALIDITY_DAYS,
} from '@nestidp/shared';
import type { CertRotationKind } from './cert-rotation-notifier';

export const DEFAULT_CERT_ROTATION_TICK_MS = 3_600_000; // 1 hour

/**
 * Bounded env config for automatic certificate rotation (Prompt 34). Mirrors the bounded-int style of
 * the sync scheduler. Per-cert lead/overlap overrides fall back to the shared value.
 */
@Injectable()
export class CertRotationConfig {
	constructor(private readonly configService: ConfigService) {}

	/** `0` disables the whole scheduler. */
	tickMs(): number {
		return this.boundedInt(
			'CERT_ROTATION_SCHEDULER_TICK_MS',
			DEFAULT_CERT_ROTATION_TICK_MS,
			0,
			86_400_000,
		);
	}

	leadDays(kind: CertRotationKind): number {
		const perCert = this.optionalInt(
			kind === 'signing' ? 'CERT_ROTATION_SIGNING_LEAD_DAYS' : 'CERT_ROTATION_ENCRYPTION_LEAD_DAYS',
			1,
			365,
		);
		return (
			perCert ?? this.boundedInt('CERT_ROTATION_LEAD_DAYS', CERT_ROTATION_DEFAULT_LEAD_DAYS, 1, 365)
		);
	}

	overlapDays(kind: CertRotationKind): number {
		const perCert = this.optionalInt(
			kind === 'signing'
				? 'CERT_ROTATION_SIGNING_OVERLAP_DAYS'
				: 'CERT_ROTATION_ENCRYPTION_OVERLAP_DAYS',
			0,
			90,
		);
		return (
			perCert ??
			this.boundedInt('CERT_ROTATION_OVERLAP_DAYS', CERT_ROTATION_DEFAULT_OVERLAP_DAYS, 0, 90)
		);
	}

	validityDays(): number {
		return this.boundedInt(
			'CERT_ROTATION_VALIDITY_DAYS',
			CERT_ROTATION_DEFAULT_VALIDITY_DAYS,
			1,
			10 * 365,
		);
	}

	notifyLeadDays(): number {
		return this.boundedInt(
			'CERT_ROTATION_NOTIFY_LEAD_DAYS',
			CERT_ROTATION_DEFAULT_NOTIFY_LEAD_DAYS,
			1,
			730,
		);
	}

	jitterMaxSeconds(): number {
		return this.boundedInt('CERT_ROTATION_JITTER_MAX_SECONDS', 0, 0, 86_400);
	}

	bootGraceHours(): number {
		return this.boundedInt('CERT_ROTATION_BOOT_GRACE_HOURS', 0, 0, 168);
	}

	failureAutodisableThreshold(): number {
		return this.boundedInt(
			'CERT_ROTATION_FAILURE_AUTODISABLE_THRESHOLD',
			CERT_ROTATION_DEFAULT_FAILURE_AUTODISABLE_THRESHOLD,
			0,
			100,
		);
	}

	dryRun(): boolean {
		const raw = this.configService.get<string | boolean>('CERT_ROTATION_DRY_RUN');
		if (typeof raw === 'boolean') {
			return raw;
		}
		return raw === 'true' || raw === '1';
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		const parsed = Number(this.configService.get<number | string>(key));
		if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
			return parsed;
		}
		return fallback;
	}

	private optionalInt(key: string, min: number, max: number): number | null {
		const raw = this.configService.get<number | string>(key);
		if (raw === undefined || raw === null || raw === '') {
			return null;
		}
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
			return parsed;
		}
		return null;
	}
}
