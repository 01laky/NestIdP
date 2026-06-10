import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EndUserLoginBodyDto } from '@api/auth/dto/end-user-login-body.dto';

describe('EndUserLoginBodyDto validation', () => {
	async function validateLogin(body: object) {
		const dto = plainToInstance(EndUserLoginBodyDto, body);
		return validate(dto);
	}

	it('API-AUTH-DTO-01: valid login body passes validation', async () => {
		const errors = await validateLogin({
			username: 'alice',
			password: 'secret',
		});
		expect(errors).toHaveLength(0);
	});

	it('API-AUTH-DTO-02: trims username via Transform', async () => {
		const dto = plainToInstance(EndUserLoginBodyDto, {
			username: '  alice  ',
			password: 'secret',
		});
		expect(dto.username).toBe('alice');
	});

	it('API-AUTH-DTO-03: optional valid samlSessionId passes', async () => {
		const errors = await validateLogin({
			username: 'alice',
			password: 'secret',
			samlSessionId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
		});
		expect(errors).toHaveLength(0);
	});

	it('API-AUTH-DTO-04: invalid samlSessionId fails validation', async () => {
		const errors = await validateLogin({
			username: 'alice',
			password: 'secret',
			samlSessionId: 'not-a-cuid',
		});
		expect(errors.some((e) => e.property === 'samlSessionId')).toBe(true);
	});

	it('API-AUTH-DTO-05: missing password fails validation', async () => {
		const errors = await validateLogin({ username: 'alice' });
		expect(errors.some((e) => e.property === 'password')).toBe(true);
	});

	it('API-AUTH-DTO-06: empty username fails IsNotEmpty', async () => {
		const errors = await validateLogin({ username: '   ', password: 'secret' });
		expect(errors.some((e) => e.property === 'username')).toBe(true);
	});

	it('API-AUTH-DTO-07: username longer than 128 fails MaxLength', async () => {
		const errors = await validateLogin({
			username: 'a'.repeat(129),
			password: 'secret',
		});
		expect(errors.some((e) => e.property === 'username')).toBe(true);
	});

	it('API-AUTH-DTO-08: password longer than 72 fails MaxLength (bcrypt 72-byte truncation)', async () => {
		const errors = await validateLogin({
			username: 'alice',
			password: 'p'.repeat(73),
		});
		expect(errors.some((e) => e.property === 'password')).toBe(true);

		const ok = await validateLogin({
			username: 'alice',
			password: 'p'.repeat(72),
		});
		expect(ok.some((e) => e.property === 'password')).toBe(false);
	});
});
