import type { EndUserPublicDto } from '@nestidp/shared';
import type { Request } from 'express';

export interface EndUserSessionPayload {
	userId: string;
	username: string;
	/** Server-side SamlSsoSession id — enables revocation of the otherwise-stateless token (v1.8.0). */
	sid?: string;
	iat: number;
	exp: number;
}

export interface EndUserAuthenticatedRequest extends Request {
	endUser?: EndUserPublicDto;
	endUserSession?: EndUserSessionPayload;
}
