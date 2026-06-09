import { Global, Module } from '@nestjs/common';
import { LOGOUT_PROPAGATION_PORT } from '@nestidp/shared';
import { AuditCoreModule } from '../audit/audit-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SamlModule } from './saml.module';
import { BackchannelLogoutConfig } from './services/backchannel-logout.config';
import { BackchannelLogoutSchedulerService } from './services/backchannel-logout-scheduler.service';
import {
	LOGOUT_PROPAGATION_NOTIFIER,
	NoopLogoutPropagationNotifier,
} from './services/logout-propagation-notifier';
import { LogoutPropagationService } from './services/logout-propagation.service';
import { SamlLogoutRequestBuilderService } from './services/saml-logout-request-builder.service';
import { SamlSoapBackchannelService } from './services/saml-soap-backchannel.service';

/**
 * Back-channel (SOAP) SLO propagation (Prompt 36). **@Global** so the low-level session registry
 * (`SamlSsoSessionService.terminate`) can consume `LOGOUT_PROPAGATION_PORT` without a module cycle —
 * this module imports `SamlModule` (for IdP signing), the registry does not import this one. The retry
 * scheduler lives here too. Single-instance.
 */
@Global()
@Module({
	imports: [PrismaModule, AuditCoreModule, SamlModule],
	providers: [
		BackchannelLogoutConfig,
		SamlLogoutRequestBuilderService,
		SamlSoapBackchannelService,
		LogoutPropagationService,
		BackchannelLogoutSchedulerService,
		{ provide: LOGOUT_PROPAGATION_NOTIFIER, useClass: NoopLogoutPropagationNotifier },
		{ provide: LOGOUT_PROPAGATION_PORT, useExisting: LogoutPropagationService },
	],
	exports: [LOGOUT_PROPAGATION_PORT, LogoutPropagationService],
})
export class BackchannelLogoutModule {}
