import { Injectable } from '@nestjs/common';
import { ActiveIdentityStore } from '../store/active-identity-store';

@Injectable()
export class IdentityService {
	constructor(private readonly store: ActiveIdentityStore) {}

	countUsers(): Promise<number> {
		return this.store.countUsers();
	}

	countGroups(): Promise<number> {
		return this.store.countGroups();
	}

	countRoles(): Promise<number> {
		return this.store.countRoles();
	}
}
