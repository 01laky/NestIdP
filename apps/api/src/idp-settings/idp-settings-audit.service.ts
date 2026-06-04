import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../audit/audit-persistence.service';

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
}
