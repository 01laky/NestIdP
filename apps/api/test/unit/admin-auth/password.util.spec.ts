import { BCRYPT_COST_FACTOR } from '@nestidp/shared';
import {
	getDummyBcryptHash,
	hashPassword,
	verifyPassword,
	verifyPasswordTimingSafe,
} from '@api/admin-auth/utils/password.util';

describe('password.util', () => {
	it('API-PWD-01: hash produces bcrypt $2 prefix', async () => {
		const hash = await hashPassword('secret-password');
		expect(hash.startsWith('$2')).toBe(true);
	});

	it('API-PWD-02: verify correct password → true', async () => {
		const hash = await hashPassword('correct');
		expect(await verifyPassword('correct', hash)).toBe(true);
	});

	it('API-PWD-03: verify wrong password → false', async () => {
		const hash = await hashPassword('correct');
		expect(await verifyPassword('wrong', hash)).toBe(false);
	});

	it('API-PWD-04: hash same password twice → different salts', async () => {
		const a = await hashPassword('same');
		const b = await hashPassword('same');
		expect(a).not.toBe(b);
	});

	it('API-PWD-05: verifyPasswordTimingSafe with null hash returns false', async () => {
		expect(await verifyPasswordTimingSafe('anything', null)).toBe(false);
	});

	it('API-PWD-06: verifyPasswordTimingSafe with valid hash behaves like verifyPassword', async () => {
		const hash = await hashPassword('known');
		expect(await verifyPasswordTimingSafe('known', hash)).toBe(true);
		expect(await verifyPasswordTimingSafe('wrong', hash)).toBe(false);
	});

	it('API-PWD-07: empty password still produces valid bcrypt hash', async () => {
		const hash = await hashPassword('');
		expect(hash.startsWith('$2')).toBe(true);
		expect(await verifyPassword('', hash)).toBe(true);
	});

	it('API-PWD-08: DUMMY_BCRYPT_HASH has bcrypt prefix', async () => {
		const { DUMMY_BCRYPT_HASH } = await import('@api/admin-auth/utils/password.util');
		expect(DUMMY_BCRYPT_HASH.startsWith('$2b$')).toBe(true);
	});

	it('API-PWD-09: dummy hash is derived from the configured bcrypt cost (§5.C)', () => {
		const dummy = getDummyBcryptHash();
		const costInHash = Number(dummy.split('$')[2]);
		expect(costInHash).toBe(BCRYPT_COST_FACTOR);
		// cached per cost — same call returns the identical hash, a different cost recomputes
		expect(getDummyBcryptHash()).toBe(dummy);
		const other = getDummyBcryptHash(4);
		expect(Number(other.split('$')[2])).toBe(4);
		expect(other).not.toBe(dummy);
	}, 15_000);

	it('API-PWD-10: a cost bcrypt rejects falls back to the pinned dummy hash', async () => {
		const { DUMMY_BCRYPT_HASH } = await import('@api/admin-auth/utils/password.util');
		// bcrypt.hashSync throws on a non-numeric rounds argument → the fallback constant is returned
		expect(getDummyBcryptHash('garbage' as unknown as number)).toBe(DUMMY_BCRYPT_HASH);
	});
});

describe('PasswordService', () => {
	it('delegates to password.util via PasswordService wrapper', async () => {
		const { PasswordService } = await import('@api/admin-auth/services/password.service');
		const service = new PasswordService();
		const hash = await service.hash('wrap-test');
		expect(await service.verify('wrap-test', hash)).toBe(true);
		expect(await service.verifyTimingSafe('wrap-test', hash)).toBe(true);
	}, 15_000);
});
