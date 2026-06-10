import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../admin-auth/utils/password.util';
import { ensureLocalDirectoryConnection } from '../identity/utils/local-directory.util';
import {
	assertProductionBootstrapPassword,
	isWeakBootstrapPassword,
	normalizeBootstrapCredential,
} from './bootstrap-security';

export interface BootstrapConfig {
	adminUsername?: string;
	adminPassword?: string;
	idpBaseUrl: string;
	nodeEnv?: string;
	encryptCredential?: (plaintext: string) => string;
}

export interface BootstrapResult {
	adminCreated: boolean;
	idpSettingsCreated: boolean;
}

export interface BootstrapLogger {
	log(message: string): void;
	warn(message: string): void;
}

const noopLogger: BootstrapLogger = {
	log: () => undefined,
	warn: () => undefined,
};

export async function runBootstrap(
	prisma: PrismaClient,
	config: BootstrapConfig,
	logger: BootstrapLogger = noopLogger,
): Promise<BootstrapResult> {
	const nodeEnv = config.nodeEnv ?? 'development';
	const adminUsername = normalizeBootstrapCredential(config.adminUsername);
	const adminPassword = normalizeBootstrapCredential(config.adminPassword);

	let adminCreated = false;
	let idpSettingsCreated = false;

	const adminCount = await prisma.adminUser.count();

	if (adminCount === 0) {
		if (adminUsername && adminPassword) {
			assertProductionBootstrapPassword(nodeEnv, adminPassword, adminCount);

			if (isWeakBootstrapPassword(adminPassword)) {
				logger.warn(
					'Bootstrap: ADMIN_PASSWORD is a default or weak value — change it immediately after first login.',
				);
			}

			const passwordHash = await hashPassword(adminPassword);
			const createdAdmin = await prisma.adminUser.create({
				data: { username: adminUsername, passwordHash },
			});
			adminCreated = true;
			logger.log(`Bootstrap: created initial admin user "${adminUsername}"`);
			// §5.C: the most privileged account creation must leave an audit row. Direct Prisma write
			// (bootstrap runs outside Nest DI); same column shape as AuditPersistenceService. Best-effort —
			// a failed audit write must never abort bootstrap.
			try {
				await prisma.auditEvent.create({
					data: {
						category: 'admin_config',
						event: 'admin_user_bootstrapped',
						actorType: 'system',
						actorId: null,
						actorLabel: null,
						subjectType: 'AdminUser',
						subjectId: createdAdmin.id,
						clientIp: null,
						metadata: { username: createdAdmin.username },
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`Bootstrap: failed to write admin_user_bootstrapped audit row — ${message}`);
			}
		} else if (nodeEnv === 'production') {
			assertProductionBootstrapPassword(nodeEnv, adminPassword, adminCount);
		} else if (adminUsername || adminPassword) {
			logger.warn(
				'Bootstrap: ADMIN_USERNAME / ADMIN_PASSWORD incomplete — initial admin seed skipped.',
			);
		} else {
			logger.warn('Bootstrap: ADMIN_USERNAME / ADMIN_PASSWORD not set; admin seed deferred.');
		}
	} else {
		logger.log('Bootstrap: admin user(s) already exist — skipping admin seed.');
	}

	const idpSettings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
	if (!idpSettings) {
		await prisma.idpSettings.create({
			data: {
				id: 'default',
				entityId: config.idpBaseUrl,
			},
		});
		idpSettingsCreated = true;
		logger.log(`Bootstrap: created IdpSettings with entityId "${config.idpBaseUrl}"`);
	}

	if (config.encryptCredential) {
		await ensureLocalDirectoryConnection(prisma, config.encryptCredential);
		logger.log('Bootstrap: local directory API connection ready');
	}

	return { adminCreated, idpSettingsCreated };
}
