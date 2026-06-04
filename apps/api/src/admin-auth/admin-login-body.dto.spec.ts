import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminLoginBodyDto } from './admin-login-body.dto';

async function validateBody(body: Record<string, unknown>) {
	const dto = plainToInstance(AdminLoginBodyDto, body);
	return validate(dto);
}

describe('AdminLoginBodyDto (API-ADM-DTO-RM)', () => {
	it('API-ADM-DTO-RM-01: accepts rememberMe true', async () => {
		const errors = await validateBody({
			username: 'admin',
			password: 'secret',
			rememberMe: true,
		});
		expect(errors).toHaveLength(0);
	});

	it('API-ADM-DTO-RM-02: accepts rememberMe string true', async () => {
		const dto = plainToInstance(AdminLoginBodyDto, {
			username: 'admin',
			password: 'secret',
			rememberMe: 'true',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
		expect(dto.rememberMe).toBe(true);
	});

	it('API-ADM-DTO-RM-03: rejects rememberMe yes', async () => {
		const errors = await validateBody({
			username: 'admin',
			password: 'secret',
			rememberMe: 'yes',
		});
		expect(errors.length).toBeGreaterThan(0);
	});

	it('API-ADM-DTO-RM-04: omits rememberMe when undefined', async () => {
		const dto = plainToInstance(AdminLoginBodyDto, {
			username: 'admin',
			password: 'secret',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
		expect(dto.rememberMe).toBeUndefined();
	});

	it('API-ADM-DTO-RM-05: coerces rememberMe string false to false', async () => {
		const dto = plainToInstance(AdminLoginBodyDto, {
			username: 'admin',
			password: 'secret',
			rememberMe: 'false',
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
		expect(dto.rememberMe).toBe(false);
	});

	it('API-ADM-DTO-RM-06: rejects rememberMe number', async () => {
		const errors = await validateBody({
			username: 'admin',
			password: 'secret',
			rememberMe: 1,
		});
		expect(errors.length).toBeGreaterThan(0);
	});

	it('API-ADM-DTO-RM-07: null rememberMe treated as omitted', async () => {
		const dto = plainToInstance(AdminLoginBodyDto, {
			username: 'admin',
			password: 'secret',
			rememberMe: null,
		});
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
		expect(dto.rememberMe).toBeUndefined();
	});

	it('API-ADM-DTO-RM-08: rejects rememberMe array', async () => {
		const errors = await validateBody({
			username: 'admin',
			password: 'secret',
			rememberMe: [true],
		});
		expect(errors.length).toBeGreaterThan(0);
	});
});
