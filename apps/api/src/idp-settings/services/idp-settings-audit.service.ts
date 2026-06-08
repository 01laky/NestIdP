import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';

@Injectable()
export class IdpSettingsAuditService {
	private readonly logger = new Logger(IdpSettingsAuditService.name);

	constructor(private readonly audit: AuditPersistenceService) {}

	logSettingsUpdated(fields: string[]): void {
		const payload = { event: 'idp_settings_updated', fields };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_settings_updated',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { fields },
		});
	}

	logSigningCertGenerated(
		rotation: boolean,
		crypto?: {
			keyFamily: string;
			signatureAlgorithmId: string;
			rsaModulusBits?: number;
			ecCurve?: string;
			notAfter?: string;
		},
	): void {
		const metadata = { rotation, ...crypto };
		const payload = { event: 'idp_signing_cert_generated', ...metadata };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_signing_cert_generated',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata,
		});
	}

	logSigningCertUploaded(rotation: boolean): void {
		const payload = { event: 'idp_signing_cert_uploaded', rotation };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_signing_cert_uploaded',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { rotation },
		});
	}

	logRotationStarted(
		mode: 'generate' | 'upload',
		crypto?: {
			keyFamily: string;
			signatureAlgorithmId: string;
			rsaModulusBits?: number;
			ecCurve?: string;
			notAfter?: string;
		},
	): void {
		const metadata = { mode, ...crypto };
		const payload = { event: 'idp_signing_rotation_started', ...metadata };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_signing_rotation_started',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata,
		});
	}

	logRotationCompleted(): void {
		const payload = { event: 'idp_signing_rotation_completed' };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_signing_rotation_completed',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
		});
	}

	logRotationCancelled(): void {
		const payload = { event: 'idp_signing_rotation_cancelled' };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_signing_rotation_cancelled',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
		});
	}

	logEncryptionCertGenerated(
		rotation: boolean,
		crypto?: {
			keyFamily?: string;
			keyTransportAlgorithmId?: string;
			rsaModulusBits?: number;
			ecCurve?: string;
			notAfter?: string;
		},
	): void {
		const metadata = { rotation, ...crypto };
		const payload = { event: 'idp_encryption_cert_generated', ...metadata };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_encryption_cert_generated',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata,
		});
	}

	logEncryptionCertUploaded(rotation: boolean): void {
		const payload = { event: 'idp_encryption_cert_uploaded', rotation };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_encryption_cert_uploaded',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { rotation },
		});
	}

	logEncryptionRotationStarted(
		mode: 'generate' | 'upload',
		crypto?: {
			keyFamily?: string;
			keyTransportAlgorithmId?: string;
			rsaModulusBits?: number;
			ecCurve?: string;
			notAfter?: string;
		},
	): void {
		const metadata = { mode, ...crypto };
		const payload = { event: 'idp_encryption_rotation_started', ...metadata };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_encryption_rotation_started',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata,
		});
	}

	logEncryptionRotationCompleted(): void {
		const payload = { event: 'idp_encryption_rotation_completed' };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_encryption_rotation_completed',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
		});
	}

	logEncryptionRotationCancelled(): void {
		const payload = { event: 'idp_encryption_rotation_cancelled' };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_encryption_rotation_cancelled',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
		});
	}

	// --- Automatic rotation (Prompt 34) — auto transitions are a `system` actor; setting/check are `admin`.

	logAutoRotationStarted(
		kind: 'signing' | 'encryption',
		dryRun: boolean,
		meta?: Record<string, unknown>,
	): void {
		const event = `idp_${kind}_rotation_auto_started`;
		const metadata = { dryRun, ...meta };
		this.logger.log(JSON.stringify({ event, ...metadata }));
		this.audit.recordSafe({
			category: 'admin_config',
			event,
			actorType: 'system',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata,
		});
	}

	logAutoRotationCompleted(kind: 'signing' | 'encryption', dryRun: boolean): void {
		const event = `idp_${kind}_rotation_auto_completed`;
		this.logger.log(JSON.stringify({ event, dryRun }));
		this.audit.recordSafe({
			category: 'admin_config',
			event,
			actorType: 'system',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { dryRun },
		});
	}

	logAutoRotationDueSoon(kind: 'signing' | 'encryption', notAfter: string | null): void {
		const event = `idp_${kind}_auto_rotation_due_soon`;
		this.logger.log(JSON.stringify({ event, notAfter }));
		this.audit.recordSafe({
			category: 'admin_config',
			event,
			actorType: 'system',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { notAfter },
		});
	}

	logAutoRotationFailed(
		kind: 'signing' | 'encryption',
		reason: string,
		consecutiveFailures: number,
	): void {
		const event = `idp_${kind}_auto_rotation_failed`;
		this.logger.warn(JSON.stringify({ event, reason, consecutiveFailures }));
		this.audit.recordSafe({
			category: 'admin_config',
			event,
			actorType: 'system',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { reason, consecutiveFailures },
		});
	}

	logAutoRotationAutodisabled(kind: 'signing' | 'encryption', consecutiveFailures: number): void {
		const event = `idp_${kind}_auto_rotation_autodisabled`;
		this.logger.warn(JSON.stringify({ event, consecutiveFailures }));
		this.audit.recordSafe({
			category: 'admin_config',
			event,
			actorType: 'system',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { consecutiveFailures },
		});
	}

	logAutoRotationSettingChanged(fields: string[]): void {
		const payload = { event: 'idp_auto_rotation_setting_changed', fields };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_auto_rotation_setting_changed',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { fields },
		});
	}

	logAutoRotationCheckRun(dryRun: boolean): void {
		const payload = { event: 'idp_auto_rotation_check_run', dryRun };
		this.logger.log(JSON.stringify(payload));
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'idp_auto_rotation_check_run',
			actorType: 'admin',
			subjectType: 'IdpSettings',
			subjectId: 'default',
			metadata: { dryRun },
		});
	}
}
