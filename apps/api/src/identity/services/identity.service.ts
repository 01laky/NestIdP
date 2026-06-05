import { Injectable } from '@nestjs/common';
import { IdentityRepository } from '../identity.repository';

@Injectable()
export class IdentityService {
	constructor(private readonly identityRepository: IdentityRepository) {}

	countUsers(): Promise<number> {
		return this.identityRepository.countUsers();
	}

	countGroups(): Promise<number> {
		return this.identityRepository.countGroups();
	}

	countRoles(): Promise<number> {
		return this.identityRepository.countRoles();
	}
}
