import { AdminCsrfService } from './admin-csrf.service';

describe('AdminCsrfService', () => {
	const service = new AdminCsrfService();

	it('API-CSRF-SVC-01: generateToken returns 64-char hex string', () => {
		const token = service.generateToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it('API-CSRF-SVC-02: validateToken accepts matching tokens', () => {
		const token = service.generateToken();
		expect(service.validateToken(token, token)).toBe(true);
	});

	it('API-CSRF-SVC-03: validateToken rejects missing header or expected', () => {
		expect(service.validateToken(undefined, 'abc')).toBe(false);
		expect(service.validateToken('abc', undefined)).toBe(false);
	});

	it('API-CSRF-SVC-04: validateToken rejects mismatch', () => {
		const token = service.generateToken();
		expect(service.validateToken(`${token}x`, token)).toBe(false);
	});
});
