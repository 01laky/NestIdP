import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ADMIN_CSRF_HEADER_NAME } from '@nestidp/shared';
import { AdminAuthenticatedRequest } from '../admin-auth.types';
import { AdminCsrfService } from '../services/admin-csrf.service';

@Injectable()
export class AdminCsrfGuard implements CanActivate {
	constructor(private readonly adminCsrfService: AdminCsrfService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
		const header = request.headers[ADMIN_CSRF_HEADER_NAME.toLowerCase()];
		const headerValue = Array.isArray(header) ? header[0] : header;
		const expected = request.adminSession?.csrfToken;

		if (!this.adminCsrfService.validateToken(headerValue, expected)) {
			throw new ForbiddenException('Invalid CSRF token');
		}

		return true;
	}
}
