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

		await this.prisma.samlSession.update({
			where: { id: samlSessionId },
			data: { userId },
		});
	}
}
