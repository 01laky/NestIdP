import { Controller, Get } from '@nestjs/common';

@Controller('api/auth')
export class AuthController {
	@Get()
	getStub() {
		return {
			status: 'stub',
			module: 'auth',
			note: 'Admin and end-user authentication will be implemented in a later prompt.',
		};
	}
}
