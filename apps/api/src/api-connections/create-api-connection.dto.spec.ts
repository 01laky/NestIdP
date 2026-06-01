import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApiConnectionBodyDto } from './create-api-connection.dto';
import { UpdateApiConnectionBodyDto } from './update-api-connection.dto';

describe('CreateApiConnectionBodyDto validation', () => {
	async function validateCreate(body: object) {
		const dto = plainToInstance(CreateApiConnectionBodyDto, body);
		return validate(dto);
	}

	it('API-DTO-01: valid create body passes validation', async () => {
		const errors = await validateCreate({
			name: 'Corp',
			baseUrl: 'https://identity.example.com',
			bearerToken: 'secret',
		});
		expect(errors).toHaveLength(0);
	});

	it('API-DTO-02: missing bearerToken fails validation', async () => {
		const errors = await validateCreate({
			name: 'Corp',
			baseUrl: 'https://identity.example.com',
		});
		expect(errors.length).toBeGreaterThan(0);
	});

	it('API-DTO-03: trims name and baseUrl via Transform', async () => {
		const dto = plainToInstance(CreateApiConnectionBodyDto, {
			name: '  Corp  ',
			baseUrl: '  https://identity.example.com  ',
			bearerToken: 'secret',
		});
		expect(dto.name).toBe('Corp');
		expect(dto.baseUrl).toBe('https://identity.example.com');
	});

	it('API-DTO-04: name over 128 chars fails validation', async () => {
		const errors = await validateCreate({
			name: 'x'.repeat(129),
			baseUrl: 'https://identity.example.com',
			bearerToken: 'secret',
		});
		expect(errors.some((e) => e.property === 'name')).toBe(true);
	});
});

describe('UpdateApiConnectionBodyDto validation', () => {
	it('API-DTO-05: optional fields allow partial update body', async () => {
		const dto = plainToInstance(UpdateApiConnectionBodyDto, { name: 'Renamed' });
		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('API-DTO-06: empty name string fails IsNotEmpty', async () => {
		const dto = plainToInstance(UpdateApiConnectionBodyDto, { name: '   ' });
		const errors = await validate(dto);
		expect(errors.some((e) => e.property === 'name')).toBe(true);
	});

	it('API-DTO-07: empty bearerToken when provided fails IsNotEmpty', async () => {
		const dto = plainToInstance(UpdateApiConnectionBodyDto, { bearerToken: '' });
		const errors = await validate(dto);
		expect(errors.some((e) => e.property === 'bearerToken')).toBe(true);
	});
});
