import { validate } from 'class-validator';
import { CompleteSsoBodyDto } from '@api/auth/dto/complete-sso-body.dto';

describe('CompleteSsoBodyDto', () => {
	it('API-AUTH-SSO-DTO-01: valid cuid passes', async () => {
		const dto = Object.assign(new CompleteSsoBodyDto(), {
			samlSessionId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
		});
		expect(await validate(dto)).toHaveLength(0);
	});

	it('API-AUTH-SSO-DTO-02: missing samlSessionId fails', async () => {
		const dto = new CompleteSsoBodyDto();
		const errors = await validate(dto);
		expect(errors.length).toBeGreaterThan(0);
	});

	it('API-AUTH-SSO-DTO-03: invalid format fails', async () => {
		const dto = Object.assign(new CompleteSsoBodyDto(), { samlSessionId: 'bad' });
		const errors = await validate(dto);
		expect(errors.some((e) => e.property === 'samlSessionId')).toBe(true);
	});
});
