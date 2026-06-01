import type { EndUserPublicDto } from '@nestidp/shared';
import type { Request } from 'express';

export interface EndUserSessionPayload {
	userId: string;
	username: string;
	iat: number;
	exp: number;
}

export interface EndUserAuthenticatedRequest extends Request {
	endUser?: EndUserPublicDto;
	endUserSession?: EndUserSessionPayload;
}
