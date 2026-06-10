import { SyncErrors } from '@api/sync/utils/sync-errors';

describe('SyncErrors (Prompt 39 D1b)', () => {
	it('ERR-01: add() produces the correct DTO shape with required fields always present', () => {
		const errors = new SyncErrors();
		errors.add('fetch_users', 'Failed to fetch users');
		errors.add('upsert_user', 'Failed to upsert user', { externalUserId: 'ext-1' });
		errors.add('fetch_groups', 'Identity API returned HTTP 503', {
			externalUserId: 'ext-1',
			httpStatus: 503,
		});

		expect(errors.toArray()).toEqual([
			{ phase: 'fetch_users', message: 'Failed to fetch users' },
			{ phase: 'upsert_user', message: 'Failed to upsert user', externalUserId: 'ext-1' },
			{
				phase: 'fetch_groups',
				message: 'Identity API returned HTTP 503',
				externalUserId: 'ext-1',
				httpStatus: 503,
			},
		]);
	});

	it('ERR-02: opts cannot override phase or message', () => {
		const errors = new SyncErrors();
		errors.add('internal', 'real message', {
			// @ts-expect-error phase/message are excluded from opts
			phase: 'fetch_users',
			message: 'spoofed',
		});

		expect(errors.toArray()).toEqual([{ phase: 'internal', message: 'real message' }]);
	});

	it('ERR-03: toArray() returns the accumulated entries in push order', () => {
		const errors = new SyncErrors();
		errors.add('oauth', 'first');
		errors.add('parse_users', 'second');
		errors.add('internal', 'third');

		expect(errors.toArray().map((e) => e.message)).toEqual(['first', 'second', 'third']);
		expect(errors.length).toBe(3);
	});

	it('ERR-04: length reflects the entry count for the errors-or-null finishLog decision', () => {
		const errors = new SyncErrors();
		expect(errors.length).toBe(0);
		errors.add('dry_run_summary', 'Dry run completed; no identity rows were modified');
		expect(errors.length).toBe(1);
	});
});
