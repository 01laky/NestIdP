import { describe, expect, it } from 'vitest';
import type { ApiErrorResponseDto } from './api-error.js';

describe('api-error shared types', () => {
	it('SH-ERR-01: ApiErrorResponseDto shape', () => {
		const sample: ApiErrorResponseDto = {
			statusCode: 401,
			message: 'Unauthorized',
		};
		expect(sample.statusCode).toBe(401);
		expect(sample.message).toBe('Unauthorized');
	});
});
