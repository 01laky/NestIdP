import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { existsSync } from 'fs';
import { WEB_INDEX_PATH } from '../spa-paths';

/**
 * Serves the React SPA shell for client-side routes in production.
 * API and SAML routes are registered in separate controllers and take precedence.
 */
@Controller()
export class SpaFallbackController {
	@Get('login')
	serveLogin(@Res() response: Response) {
		return this.sendIndex(response);
	}

	@Get('admin')
	@Get('admin/*path')
	serveAdmin(@Res() response: Response) {
		return this.sendIndex(response);
	}

	private sendIndex(response: Response) {
		if (!existsSync(WEB_INDEX_PATH)) {
			return response.status(503).json({
				status: 'unavailable',
				message: 'Web build not found. Run pnpm build before production start.',
			});
		}
		return response.sendFile(WEB_INDEX_PATH, { dotfiles: 'allow' });
	}
}
