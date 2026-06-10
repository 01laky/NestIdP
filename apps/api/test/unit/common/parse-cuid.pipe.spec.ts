import { BadRequestException } from '@nestjs/common';
import { ParseCuidPipe } from '@api/common/pipes/parse-cuid.pipe';

describe('ParseCuidPipe', () => {
	const pipe = new ParseCuidPipe();

	it('API-CUID-01: valid cuid passes through unchanged', () => {
		const id = 'clxyz1234567890123456789012';
		expect(pipe.transform(id)).toBe(id);
	});

	it('API-CUID-02: invalid id → BadRequestException', () => {
		expect(() => pipe.transform('not-a-cuid')).toThrow(BadRequestException);
		expect(() => pipe.transform('not-a-cuid')).toThrow('Invalid id');
	});

	it('API-CUID-03: UUID format rejected (Prisma uses cuid not UUID)', () => {
		expect(() => pipe.transform('550e8400-e29b-41d4-a716-446655440000')).toThrow(
			BadRequestException,
		);
	});

	it('API-CUID-04: empty string rejected', () => {
		expect(() => pipe.transform('')).toThrow(BadRequestException);
	});

	it('API-CUID-05: too-short cuid rejected', () => {
		expect(() => pipe.transform('c123')).toThrow(BadRequestException);
	});

	it('API-CUID-06: over-long id rejected (bounded at 64 chars, §5.C)', () => {
		expect(() => pipe.transform(`c${'a'.repeat(64)}`)).toThrow(BadRequestException);
		expect(() => pipe.transform(`c${'a'.repeat(10_000)}`)).toThrow(BadRequestException);
		expect(pipe.transform(`c${'a'.repeat(63)}`)).toBe(`c${'a'.repeat(63)}`);
	});

	it('API-CUID-07: uppercase rejected (Prisma cuids are lowercase)', () => {
		expect(() => pipe.transform('CLXYZ1234567890123456789012')).toThrow(BadRequestException);
		expect(() => pipe.transform('clxyZ1234567890123456789012')).toThrow(BadRequestException);
	});
});
