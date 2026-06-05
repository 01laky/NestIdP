import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TriggerSyncBodyDto } from '@api/sync/dto/trigger-sync.dto';

describe('TriggerSyncBodyDto', () => {
	it('accepts empty body (dryRun optional)', () => {
		const dto = plainToInstance(TriggerSyncBodyDto, {});
		expect(validateSync(dto)).toHaveLength(0);
	});

	it('accepts dryRun: true', () => {
		const dto = plainToInstance(TriggerSyncBodyDto, { dryRun: true });
		expect(validateSync(dto)).toHaveLength(0);
		expect(dto.dryRun).toBe(true);
	});

	it('accepts dryRun: false', () => {
		const dto = plainToInstance(TriggerSyncBodyDto, { dryRun: false });
		expect(validateSync(dto)).toHaveLength(0);
	});

	it('rejects non-boolean dryRun', () => {
		const dto = plainToInstance(TriggerSyncBodyDto, { dryRun: 'yes' });
		expect(validateSync(dto).length).toBeGreaterThan(0);
	});
});
