import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { SamlSessionBindPort } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';

@Injectable()
export class SamlSessionBindService implements SamlSessionBindPort {
	constructor(private readonly prisma: PrismaService) {}

	async bindUserToSession(samlSessionId: string, userId: string): Promise<void> {
		const session = await this.prisma.samlSession.findUnique({
			where: { id: samlSessionId },
			include: { spConnection: true },
		});

		if (!session) {
			throw new BadRequestException('Invalid SAML session');
		}

		if (session.expiresAt <= new Date()) {
			throw new BadRequestException('SAML session expired');
		}

		if (session.userId != null) {
			throw new ConflictException('SAML session already authenticated');
		}

		if (!session.spConnection.active) {
			throw new BadRequestException('SP connection is inactive');
		}

		// §5.A9: atomic conditional bind. The checks above give precise error messages, but the bind itself
		// must be a single guarded write — otherwise two concurrent logins both pass the `userId == null`
		// check and the second silently overwrites the first. Only update while still unbound + unexpired;
		// count === 0 means another request won the race (or it just expired) → conflict.
		const result = await this.prisma.samlSession.updateMany({
			where: { id: samlSessionId, userId: null, expiresAt: { gt: new Date() } },
			data: { userId },
		});
		if (result.count === 0) {
			throw new ConflictException('SAML session already authenticated');
		}
	}
}
