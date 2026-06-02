import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class IdpSettingsAuditService {
	private readonly logger = new Logger(IdpSettingsAuditService.name);

	logSettingsUpdated(fields: string[]): void {
		this.logger.log(JSON.stringify({ event: 'idp_settings_updated', fields }));
	}

	logSigningCertGenerated(rotation: boolean): void {
		this.logger.log(JSON.stringify({ event: 'idp_signing_cert_generated', rotation }));
	}

	logSigningCertUploaded(rotation: boolean): void {
		this.logger.log(JSON.stringify({ event: 'idp_signing_cert_uploaded', rotation }));
	}

	logRotationStarted(mode: 'generate' | 'upload'): void {
		this.logger.log(JSON.stringify({ event: 'idp_signing_rotation_started', mode }));
	}

	logRotationCompleted(): void {
		this.logger.log(JSON.stringify({ event: 'idp_signing_rotation_completed' }));
	}

	logRotationCancelled(): void {
		this.logger.log(JSON.stringify({ event: 'idp_signing_rotation_cancelled' }));
	}
}
