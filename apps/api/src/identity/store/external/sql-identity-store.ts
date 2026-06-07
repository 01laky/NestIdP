import cuid from 'cuid';
import type { Kysely } from 'kysely';
import { IdentityOrigin } from '@prisma/client';
import {
	GroupNameCollisionError,
	RoleNameCollisionError,
	UsernameCollisionError,
} from '../../identity.repository';
import { manualExternalId } from '../../utils/local-directory.util';
import { normalizeSyncedEmail } from '../../utils/normalize-synced-email.util';
import type { ExternalDialect } from './external-connection';
import {
	type ExternalIdentityDB,
	type NestidpGroupTable,
	type NestidpUserTable,
	T_GROUP,
	T_ROLE,
	T_USER,
	T_USER_GROUP,
	T_USER_ROLE,
} from './external-schema-types';
import type {
	CreateManualUserInput,
	IdentityStore,
	ListQuery,
	ListResult,
	StoreGroup,
	StoreGroupWithCount,
	StoreMember,
	StoreRole,
	StoreRoleWithCount,
	StoreUser,
	UpdateManualUserInput,
	UpsertUserInput,
	UserProfileForAuth,
	UserWithMemberships,
} from '../identity-store';

function isUniqueViolation(error: unknown): boolean {
	const e = error as { code?: string; errno?: number; message?: string };
	return (
		e?.code === '23505' || // Postgres unique_violation
		e?.errno === 1062 || // MySQL ER_DUP_ENTRY
		/duplicate|unique constraint|unique violation/i.test(e?.message ?? '')
	);
}

function mapUser(row: NestidpUserTable): StoreUser {
	return {
		id: row.id,
		externalId: row.external_id,
		apiConnectionId: row.api_connection_id,
		origin: row.origin as IdentityOrigin,
		username: row.username,
		email: row.email,
		displayName: row.display_name,
		passwordHash: row.password_hash,
		passwordHashAlgorithm: row.password_hash_algorithm,
		active: Boolean(row.active),
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
	};
}

function mapGroup(row: NestidpGroupTable): StoreGroup {
	return {
		id: row.id,
		externalId: row.external_id,
		apiConnectionId: row.api_connection_id,
		origin: row.origin as IdentityOrigin,
		name: row.name,
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
	};
}

/** External (Postgres/MySQL via Kysely) implementation of {@link IdentityStore}. */
export class SqlIdentityStore implements IdentityStore {
	private readonly likeOp: 'ilike' | 'like';

	constructor(
		private readonly db: Kysely<ExternalIdentityDB>,
		private readonly dialect: ExternalDialect,
	) {
		this.likeOp = dialect === 'postgres' ? 'ilike' : 'like';
	}

	private now(): Date {
		return new Date();
	}

	private async count(table: typeof T_USER | typeof T_GROUP | typeof T_ROLE): Promise<number> {
		const row = await this.db.selectFrom(table).select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
		return Number(row?.n ?? 0);
	}

	countUsers(): Promise<number> {
		return this.count(T_USER);
	}
	countGroups(): Promise<number> {
		return this.count(T_GROUP);
	}
	countRoles(): Promise<number> {
		return this.count(T_ROLE);
	}

	async findUserByUsername(username: string): Promise<StoreUser | null> {
		const row = await this.db.selectFrom(T_USER).selectAll().where('username', '=', username).executeTakeFirst();
		return row ? mapUser(row) : null;
	}

	async findUserProfileById(userId: string): Promise<UserProfileForAuth | null> {
		const user = await this.db
			.selectFrom(T_USER)
			.select(['id', 'username', 'email', 'display_name', 'active'])
			.where('id', '=', userId)
			.executeTakeFirst();
		if (!user) {
			return null;
		}
		const groups = await this.db
			.selectFrom(T_USER_GROUP)
			.innerJoin(T_GROUP, `${T_GROUP}.id`, `${T_USER_GROUP}.group_id`)
			.select(`${T_GROUP}.name as name`)
			.where(`${T_USER_GROUP}.user_id`, '=', userId)
			.execute();
		const roles = await this.db
			.selectFrom(T_USER_ROLE)
			.innerJoin(T_ROLE, `${T_ROLE}.id`, `${T_USER_ROLE}.role_id`)
			.select(`${T_ROLE}.name as name`)
			.where(`${T_USER_ROLE}.user_id`, '=', userId)
			.execute();
		return {
			id: user.id,
			username: user.username,
			email: user.email,
			displayName: user.display_name,
			active: Boolean(user.active),
			groups: groups.map((g) => g.name),
			roles: roles.map((r) => r.name),
		};
	}

	async upsertUser(connectionId: string, user: UpsertUserInput): Promise<{ id: string }> {
		const existingByUsername = await this.db
			.selectFrom(T_USER)
			.select(['id', 'api_connection_id', 'external_id'])
			.where('username', '=', user.username)
			.executeTakeFirst();
		if (
			existingByUsername &&
			(existingByUsername.api_connection_id !== connectionId ||
				existingByUsername.external_id !== user.externalId)
		) {
			throw new UsernameCollisionError(user.externalId, user.username);
		}

		let email = user.email;
		if (email != null) {
			try {
				email = normalizeSyncedEmail(email);
			} catch {
				email = null;
			}
		}

		const existing = await this.db
			.selectFrom(T_USER)
			.select(['id', 'origin'])
			.where('api_connection_id', '=', connectionId)
			.where('external_id', '=', user.externalId)
			.executeTakeFirst();
		if (existing?.origin === IdentityOrigin.MANUAL) {
			throw new UsernameCollisionError(user.externalId, user.username);
		}

		if (existing) {
			await this.db
				.updateTable(T_USER)
				.set({
					username: user.username,
					email,
					display_name: user.displayName,
					password_hash: user.passwordHash,
					password_hash_algorithm: user.passwordHashAlgorithm,
					active: user.active,
					updated_at: this.now(),
				})
				.where('id', '=', existing.id)
				.execute();
			return { id: existing.id };
		}

		const id = cuid();
		const now = this.now();
		await this.db
			.insertInto(T_USER)
			.values({
				id,
				external_id: user.externalId,
				api_connection_id: connectionId,
				origin: IdentityOrigin.SYNCED,
				username: user.username,
				email,
				display_name: user.displayName,
				password_hash: user.passwordHash,
				password_hash_algorithm: user.passwordHashAlgorithm,
				active: user.active,
				created_at: now,
				updated_at: now,
			})
			.execute();
		return { id };
	}

	async replaceUserGroups(userId: string, groupIds: string[]): Promise<void> {
		await this.db.transaction().execute(async (trx) => {
			await trx.deleteFrom(T_USER_GROUP).where('user_id', '=', userId).execute();
			if (groupIds.length > 0) {
				await trx
					.insertInto(T_USER_GROUP)
					.values(groupIds.map((groupId) => ({ user_id: userId, group_id: groupId })))
					.execute();
			}
		});
	}

	async replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
		await this.db.transaction().execute(async (trx) => {
			await trx.deleteFrom(T_USER_ROLE).where('user_id', '=', userId).execute();
			if (roleIds.length > 0) {
				await trx
					.insertInto(T_USER_ROLE)
					.values(roleIds.map((roleId) => ({ user_id: userId, role_id: roleId })))
					.execute();
			}
		});
	}

	private async upsertNamed(
		table: typeof T_GROUP | typeof T_ROLE,
		connectionId: string,
		external: { id: string; name: string },
		onCollision: () => never,
	): Promise<{ id: string }> {
		try {
			const existing = await this.db
				.selectFrom(table)
				.select(['id'])
				.where('api_connection_id', '=', connectionId)
				.where('external_id', '=', external.id)
				.executeTakeFirst();
			if (existing) {
				await this.db
					.updateTable(table)
					.set({ name: external.name, updated_at: this.now() })
					.where('id', '=', existing.id)
					.execute();
				return { id: existing.id };
			}
			const id = cuid();
			const now = this.now();
			await this.db
				.insertInto(table)
				.values({
					id,
					external_id: external.id,
					api_connection_id: connectionId,
					origin: IdentityOrigin.SYNCED,
					name: external.name,
					created_at: now,
					updated_at: now,
				})
				.execute();
			return { id };
		} catch (error) {
			if (isUniqueViolation(error)) {
				onCollision();
			}
			throw error;
		}
	}

	upsertGroup(connectionId: string, externalGroup: { id: string; name: string }): Promise<{ id: string }> {
		return this.upsertNamed(T_GROUP, connectionId, externalGroup, () => {
			throw new GroupNameCollisionError(externalGroup.id, externalGroup.name);
		});
	}

	upsertRole(connectionId: string, externalRole: { id: string; name: string }): Promise<{ id: string }> {
		return this.upsertNamed(T_ROLE, connectionId, externalRole, () => {
			throw new RoleNameCollisionError(externalRole.id, externalRole.name);
		});
	}

	async deactivateUsersNotInExternalIds(connectionId: string, externalIds: Set<string>): Promise<number> {
		const ids = Array.from(externalIds);
		let q = this.db
			.selectFrom(T_USER)
			.select('id')
			.where('api_connection_id', '=', connectionId)
			.where('origin', '=', IdentityOrigin.SYNCED)
			.where('active', '=', true);
		if (ids.length > 0) {
			q = q.where('external_id', 'not in', ids);
		}
		const toDeactivate = await q.execute();
		for (const { id } of toDeactivate) {
			await this.db.transaction().execute(async (trx) => {
				await trx.deleteFrom(T_USER_GROUP).where('user_id', '=', id).execute();
				await trx.deleteFrom(T_USER_ROLE).where('user_id', '=', id).execute();
				await trx.updateTable(T_USER).set({ active: false, updated_at: this.now() }).where('id', '=', id).execute();
			});
		}
		return toDeactivate.length;
	}

	private async deleteOrphans(
		table: typeof T_GROUP | typeof T_ROLE,
		connectionId: string,
		seen: Set<string>,
	): Promise<number> {
		const ids = Array.from(seen);
		// Count then delete so the returned number is correct on every dialect (we do not rely on the
		// driver populating numDeletedRows). The two statements run inside one transaction.
		return this.db.transaction().execute(async (trx) => {
			let countQ = trx
				.selectFrom(table)
				.select((eb) => eb.fn.countAll().as('n'))
				.where('api_connection_id', '=', connectionId)
				.where('origin', '=', IdentityOrigin.SYNCED);
			let delQ = trx
				.deleteFrom(table)
				.where('api_connection_id', '=', connectionId)
				.where('origin', '=', IdentityOrigin.SYNCED);
			if (ids.length > 0) {
				countQ = countQ.where('external_id', 'not in', ids);
				delQ = delQ.where('external_id', 'not in', ids);
			}
			const countRow = await countQ.executeTakeFirst();
			await delQ.execute();
			return Number(countRow?.n ?? 0);
		});
	}

	deleteOrphanGroups(connectionId: string, seenExternalIds: Set<string>): Promise<number> {
		return this.deleteOrphans(T_GROUP, connectionId, seenExternalIds);
	}
	deleteOrphanRoles(connectionId: string, seenExternalIds: Set<string>): Promise<number> {
		return this.deleteOrphans(T_ROLE, connectionId, seenExternalIds);
	}

	// --- admin: users ---

	async listUsers(query: ListQuery): Promise<ListResult<StoreUser>> {
		const term = query.search?.trim();
		const origin = query.origin;
		const rows = await this.db
			.selectFrom(T_USER)
			.selectAll()
			.$if(!!origin, (qb) => qb.where('origin', '=', origin as string))
			.$if(!!term, (qb) =>
				qb.where((eb) =>
					eb.or([eb('username', this.likeOp, `%${term}%`), eb('email', this.likeOp, `%${term}%`)]),
				),
			)
			.orderBy('username', 'asc')
			.limit(query.limit)
			.offset(query.offset)
			.execute();
		const totalRow = await this.db
			.selectFrom(T_USER)
			.select((eb) => eb.fn.countAll().as('n'))
			.$if(!!origin, (qb) => qb.where('origin', '=', origin as string))
			.$if(!!term, (qb) =>
				qb.where((eb) =>
					eb.or([eb('username', this.likeOp, `%${term}%`), eb('email', this.likeOp, `%${term}%`)]),
				),
			)
			.executeTakeFirst();
		return { items: rows.map(mapUser), total: Number(totalRow?.n ?? 0) };
	}

	async getUserById(id: string): Promise<StoreUser | null> {
		const row = await this.db.selectFrom(T_USER).selectAll().where('id', '=', id).executeTakeFirst();
		return row ? mapUser(row) : null;
	}

	async getUserWithMemberships(id: string): Promise<UserWithMemberships | null> {
		const row = await this.db.selectFrom(T_USER).selectAll().where('id', '=', id).executeTakeFirst();
		if (!row) {
			return null;
		}
		const groups = await this.db
			.selectFrom(T_USER_GROUP)
			.innerJoin(T_GROUP, `${T_GROUP}.id`, `${T_USER_GROUP}.group_id`)
			.select([`${T_GROUP}.id as id`, `${T_GROUP}.name as name`, `${T_GROUP}.origin as origin`])
			.where(`${T_USER_GROUP}.user_id`, '=', id)
			.execute();
		const roles = await this.db
			.selectFrom(T_USER_ROLE)
			.innerJoin(T_ROLE, `${T_ROLE}.id`, `${T_USER_ROLE}.role_id`)
			.select([`${T_ROLE}.id as id`, `${T_ROLE}.name as name`, `${T_ROLE}.origin as origin`])
			.where(`${T_USER_ROLE}.user_id`, '=', id)
			.execute();
		return {
			user: mapUser(row),
			groups: groups.map((g) => ({ id: g.id, name: g.name, origin: g.origin as IdentityOrigin })),
			roles: roles.map((r) => ({ id: r.id, name: r.name, origin: r.origin as IdentityOrigin })),
		};
	}

	async createManualUser(input: CreateManualUserInput): Promise<StoreUser> {
		const id = cuid();
		const now = this.now();
		await this.db.transaction().execute(async (trx) => {
			await trx
				.insertInto(T_USER)
				.values({
					id,
					external_id: manualExternalId('user', id),
					api_connection_id: input.apiConnectionId,
					origin: IdentityOrigin.MANUAL,
					username: input.username,
					email: input.email,
					display_name: input.displayName,
					password_hash: input.passwordHash,
					password_hash_algorithm: input.passwordHashAlgorithm,
					active: input.active,
					created_at: now,
					updated_at: now,
				})
				.execute();
			if (input.groupIds.length > 0) {
				await trx
					.insertInto(T_USER_GROUP)
					.values(input.groupIds.map((groupId) => ({ user_id: id, group_id: groupId })))
					.execute();
			}
			if (input.roleIds.length > 0) {
				await trx
					.insertInto(T_USER_ROLE)
					.values(input.roleIds.map((roleId) => ({ user_id: id, role_id: roleId })))
					.execute();
			}
		});
		const created = await this.getUserById(id);
		if (!created) {
			throw new Error('createManualUser: row not found after insert');
		}
		return created;
	}

	async updateManualUser(id: string, input: UpdateManualUserInput): Promise<void> {
		await this.db.transaction().execute(async (trx) => {
			const set: Partial<NestidpUserTable> = { updated_at: this.now() };
			if (input.username !== undefined) {
				set.username = input.username;
			}
			if (input.email !== undefined) {
				set.email = input.email;
			}
			if (input.displayName !== undefined) {
				set.display_name = input.displayName;
			}
			if (input.active !== undefined) {
				set.active = input.active;
			}
			if (input.passwordHash !== undefined) {
				set.password_hash = input.passwordHash;
			}
			await trx.updateTable(T_USER).set(set).where('id', '=', id).execute();
			if (input.groupIds !== undefined) {
				await trx.deleteFrom(T_USER_GROUP).where('user_id', '=', id).execute();
				if (input.groupIds.length > 0) {
					await trx
						.insertInto(T_USER_GROUP)
						.values(input.groupIds.map((groupId) => ({ user_id: id, group_id: groupId })))
						.execute();
				}
			}
			if (input.roleIds !== undefined) {
				await trx.deleteFrom(T_USER_ROLE).where('user_id', '=', id).execute();
				if (input.roleIds.length > 0) {
					await trx
						.insertInto(T_USER_ROLE)
						.values(input.roleIds.map((roleId) => ({ user_id: id, role_id: roleId })))
						.execute();
				}
			}
		});
	}

	async deleteUser(id: string): Promise<void> {
		await this.db.deleteFrom(T_USER).where('id', '=', id).execute();
	}

	async isUsernameTaken(username: string, excludeId?: string): Promise<boolean> {
		const row = await this.db.selectFrom(T_USER).select('id').where('username', '=', username).executeTakeFirst();
		return row != null && row.id !== excludeId;
	}

	private async existsAll(table: typeof T_GROUP | typeof T_ROLE, ids: string[]): Promise<boolean> {
		if (ids.length === 0) {
			return true;
		}
		const row = await this.db
			.selectFrom(table)
			.select((eb) => eb.fn.countAll().as('n'))
			.where('id', 'in', ids)
			.executeTakeFirst();
		return Number(row?.n ?? 0) === ids.length;
	}

	groupsExistAll(ids: string[]): Promise<boolean> {
		return this.existsAll(T_GROUP, ids);
	}
	rolesExistAll(ids: string[]): Promise<boolean> {
		return this.existsAll(T_ROLE, ids);
	}

	// --- admin: groups / roles (shared impl) ---

	private async listNamed(
		table: typeof T_GROUP | typeof T_ROLE,
		joinTable: typeof T_USER_GROUP | typeof T_USER_ROLE,
		fk: 'group_id' | 'role_id',
		query: ListQuery,
	): Promise<ListResult<StoreGroupWithCount>> {
		let base = this.db.selectFrom(table).selectAll();
		let countQ = this.db.selectFrom(table).select((eb) => eb.fn.countAll().as('n'));
		if (query.origin) {
			base = base.where('origin', '=', query.origin);
			countQ = countQ.where('origin', '=', query.origin);
		}
		const rows = await base.orderBy('name', 'asc').limit(query.limit).offset(query.offset).execute();
		const totalRow = await countQ.executeTakeFirst();
		const counts = await this.memberCounts(joinTable, fk, rows.map((r) => r.id));
		return {
			items: rows.map((r) => ({ ...mapGroup(r), memberCount: counts.get(r.id) ?? 0 })),
			total: Number(totalRow?.n ?? 0),
		};
	}

	private async memberCounts(
		joinTable: typeof T_USER_GROUP | typeof T_USER_ROLE,
		fk: 'group_id' | 'role_id',
		ids: string[],
	): Promise<Map<string, number>> {
		const map = new Map<string, number>();
		if (ids.length === 0) {
			return map;
		}
		const rows = await this.db
			.selectFrom(joinTable)
			.select((eb) => [eb.ref(fk).as('fk'), eb.fn.countAll().as('n')])
			.where(fk, 'in', ids)
			.groupBy(fk)
			.execute();
		for (const r of rows) {
			map.set(String((r as { fk: string }).fk), Number(r.n));
		}
		return map;
	}

	private async getNamedById(
		table: typeof T_GROUP | typeof T_ROLE,
		joinTable: typeof T_USER_GROUP | typeof T_USER_ROLE,
		fk: 'group_id' | 'role_id',
		id: string,
	): Promise<StoreGroupWithCount | null> {
		const row = await this.db.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst();
		if (!row) {
			return null;
		}
		const memberCount = await this.namedMemberCount(joinTable, fk, id);
		return { ...mapGroup(row), memberCount };
	}

	private async namedMemberCount(
		joinTable: typeof T_USER_GROUP | typeof T_USER_ROLE,
		fk: 'group_id' | 'role_id',
		id: string,
	): Promise<number> {
		const row = await this.db
			.selectFrom(joinTable)
			.select((eb) => eb.fn.countAll().as('n'))
			.where(fk, '=', id)
			.executeTakeFirst();
		return Number(row?.n ?? 0);
	}

	private async getNamedMembers(
		joinTable: typeof T_USER_GROUP | typeof T_USER_ROLE,
		fk: 'group_id' | 'role_id',
		id: string,
		max: number,
	): Promise<StoreMember[]> {
		const rows = await this.db
			.selectFrom(joinTable)
			.innerJoin(T_USER, `${T_USER}.id`, `${joinTable}.user_id`)
			.select([`${T_USER}.id as id`, `${T_USER}.username as username`, `${T_USER}.origin as origin`])
			.where(fk, '=', id)
			.orderBy(`${T_USER}.username`, 'asc')
			.limit(max)
			.execute();
		return rows.map((r) => ({ id: r.id, username: r.username, origin: r.origin as IdentityOrigin }));
	}

	private async createNamed(
		table: typeof T_GROUP | typeof T_ROLE,
		kind: 'group' | 'role',
		apiConnectionId: string,
		name: string,
	): Promise<StoreGroup> {
		const id = cuid();
		const now = this.now();
		await this.db
			.insertInto(table)
			.values({
				id,
				external_id: manualExternalId(kind, id),
				api_connection_id: apiConnectionId,
				origin: IdentityOrigin.MANUAL,
				name,
				created_at: now,
				updated_at: now,
			})
			.execute();
		const row = await this.db.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst();
		if (!row) {
			throw new Error(`createNamed: ${kind} not found after insert`);
		}
		return mapGroup(row);
	}

	private async isNamedTaken(
		table: typeof T_GROUP | typeof T_ROLE,
		apiConnectionId: string,
		name: string,
		excludeId?: string,
	): Promise<boolean> {
		const row = await this.db
			.selectFrom(table)
			.select('id')
			.where('api_connection_id', '=', apiConnectionId)
			.where('name', '=', name)
			.executeTakeFirst();
		return row != null && row.id !== excludeId;
	}

	listGroups(query: ListQuery): Promise<ListResult<StoreGroupWithCount>> {
		return this.listNamed(T_GROUP, T_USER_GROUP, 'group_id', query);
	}
	getGroupById(id: string): Promise<StoreGroupWithCount | null> {
		return this.getNamedById(T_GROUP, T_USER_GROUP, 'group_id', id);
	}
	getGroupMembers(id: string, max: number): Promise<StoreMember[]> {
		return this.getNamedMembers(T_USER_GROUP, 'group_id', id, max);
	}
	createManualGroup(apiConnectionId: string, name: string): Promise<StoreGroup> {
		return this.createNamed(T_GROUP, 'group', apiConnectionId, name);
	}
	async updateGroupName(id: string, name: string): Promise<void> {
		await this.db.updateTable(T_GROUP).set({ name, updated_at: this.now() }).where('id', '=', id).execute();
	}
	async deleteGroup(id: string): Promise<void> {
		await this.db.deleteFrom(T_GROUP).where('id', '=', id).execute();
	}
	groupMemberCount(id: string): Promise<number> {
		return this.namedMemberCount(T_USER_GROUP, 'group_id', id);
	}
	isGroupNameTaken(apiConnectionId: string, name: string, excludeId?: string): Promise<boolean> {
		return this.isNamedTaken(T_GROUP, apiConnectionId, name, excludeId);
	}

	listRoles(query: ListQuery): Promise<ListResult<StoreRoleWithCount>> {
		return this.listNamed(T_ROLE, T_USER_ROLE, 'role_id', query);
	}
	getRoleById(id: string): Promise<StoreRoleWithCount | null> {
		return this.getNamedById(T_ROLE, T_USER_ROLE, 'role_id', id);
	}
	getRoleMembers(id: string, max: number): Promise<StoreMember[]> {
		return this.getNamedMembers(T_USER_ROLE, 'role_id', id, max);
	}
	createManualRole(apiConnectionId: string, name: string): Promise<StoreRole> {
		return this.createNamed(T_ROLE, 'role', apiConnectionId, name);
	}
	async updateRoleName(id: string, name: string): Promise<void> {
		await this.db.updateTable(T_ROLE).set({ name, updated_at: this.now() }).where('id', '=', id).execute();
	}
	async deleteRole(id: string): Promise<void> {
		await this.db.deleteFrom(T_ROLE).where('id', '=', id).execute();
	}
	roleMemberCount(id: string): Promise<number> {
		return this.namedMemberCount(T_USER_ROLE, 'role_id', id);
	}
	isRoleNameTaken(apiConnectionId: string, name: string, excludeId?: string): Promise<boolean> {
		return this.isNamedTaken(T_ROLE, apiConnectionId, name, excludeId);
	}
}
