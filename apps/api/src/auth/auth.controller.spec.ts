import { AuthController } from './auth.controller';

describe('AuthController', () => {
	const controller = new AuthController();

	it('returns auth stub payload', () => {
		expect(controller.getStub()).toEqual({
			status: 'stub',
			module: 'auth',
			note: 'Admin and end-user authentication will be implemented in a later prompt.',
		});
	});

	it('does not expose admin module identifier', () => {
		const result = controller.getStub();
		expect(result.module).toBe('auth');
		expect(result.module).not.toBe('admin');
	});
});
