import { SyncController } from '@api/sync/controllers/sync.controller';
import type { SyncService } from '@api/sync/services/sync.service';
import type { AdminAuthenticatedRequest } from '@api/admin-auth/admin-auth.types';

const CONNECTION_ID = 'c1234567890123456789012345';

describe('SyncController', () => {
	const syncService = {
		triggerSync: jest.fn().mockResolvedValue({}),
		syncAll: jest.fn().mockResolvedValue({}),
	};
	const controller = new SyncController(syncService as unknown as SyncService);
	const req = {
		adminUser: { id: 'admin-1', username: 'root' },
	} as AdminAuthenticatedRequest;

	beforeEach(() => jest.clearAllMocks());

	it('API-SYNC-CTRL-01: triggerSync accepts dryRun from body OR ?dryRun=true query (§5.C)', async () => {
		await controller.triggerSync(CONNECTION_ID, { dryRun: true }, undefined, req);
		expect(syncService.triggerSync).toHaveBeenLastCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ dryRun: true }),
		);

		await controller.triggerSync(CONNECTION_ID, {}, 'true', req);
		expect(syncService.triggerSync).toHaveBeenLastCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ dryRun: true }),
		);

		// Anything other than the literal 'true' query value is not a dry run.
		await controller.triggerSync(CONNECTION_ID, {}, 'yes', req);
		expect(syncService.triggerSync).toHaveBeenLastCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ dryRun: false }),
		);

		await controller.triggerSync(CONNECTION_ID, {}, undefined, req);
		expect(syncService.triggerSync).toHaveBeenLastCalledWith(
			CONNECTION_ID,
			expect.objectContaining({ dryRun: false }),
		);
	});

	it('API-SYNC-CTRL-02: syncAll keeps the same body-OR-query dryRun precedence', async () => {
		await controller.syncAll({}, 'true', req);
		expect(syncService.syncAll).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true }));

		await controller.syncAll({ dryRun: true }, undefined, req);
		expect(syncService.syncAll).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true }));

		await controller.syncAll({}, undefined, req);
		expect(syncService.syncAll).toHaveBeenLastCalledWith(
			expect.objectContaining({ dryRun: false }),
		);
	});
});
