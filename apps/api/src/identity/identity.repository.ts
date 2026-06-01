import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdentityRepository {
	constructor(private readonly prisma: PrismaService) {}

	countUsers(): Promise<number> {
		return this.prisma.user.count();
	}

	countGroups(): Promise<number> {
		return this.prisma.group.count();
	}

	countRoles(): Promise<number> {
		return this.prisma.role.count();
	}
}
