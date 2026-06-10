import { Injectable } from '@nestjs/common';
import { IdentityRepository } from '../identity.repository';
import type { IdentityStore } from './identity-store';

export type IdentityStoreMode = 'local' | 'external' | 'mirror';

/**
 * Proxy handler that forwards every {@link IdentityStore} method to the currently-active delegate
 * (Prompt 38 §A18). Own members of the wrapper (the control methods + state) are returned as-is; anything
 * else is read from `getActive()` and bound to it, so the ~45 verbatim hand-written delegations are gone
 * and a new interface method is delegated automatically (no risk of forgetting one).
 */
const DELEGATING_HANDLER: ProxyHandler<ActiveIdentityStore> = {
	get(target, prop, receiver) {
		if (Reflect.has(target, prop)) {
			return Reflect.get(target, prop, receiver);
		}
		const delegate = target.getActive() as unknown as Record<string | symbol, unknown>;
		const value = delegate[prop];
		return typeof value === 'function'
			? (value as (...a: unknown[]) => unknown).bind(delegate)
			: value;
	},
};

// Declaration merge: the wrapper exposes the full IdentityStore surface at the type level, while the
// methods are provided at runtime by DELEGATING_HANDLER rather than ~45 hand-written forwarders. The merge
// is intentional (the class deliberately does not implement the interface members — the Proxy does).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface ActiveIdentityStore extends IdentityStore {}

/**
 * The injected identity store seen by every consumer (auth, SAML, sync, identity-admin, stats).
 * It delegates to the currently-active {@link IdentityStore} implementation and supports an atomic
 * hot-swap (Prompt 31) so an external database can be attached/detached at runtime with no restart.
 * Default delegate is the local libSQL {@link IdentityRepository}.
 */
@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- runtime delegation via Proxy
export class ActiveIdentityStore {
	private current: IdentityStore;
	private currentMode: IdentityStoreMode = 'local';

	constructor(private readonly local: IdentityRepository) {
		this.current = local;
		// Returning a Proxy from the constructor makes it the instance Nest registers + injects.
		return new Proxy(this, DELEGATING_HANDLER);
	}

	/**
	 * Swap the active delegate atomically. Pass the local repo (or mode 'local') to revert.
	 *
	 * Hot-swap window: the swap is atomic for NEW calls only — method calls already in flight finish
	 * against the OLD delegate. Accepted: swaps happen only through the rare admin connect/disconnect
	 * operations, and both delegates are consistent databases, so a straggler completes safely.
	 */
	setActive(store: IdentityStore, mode: IdentityStoreMode): void {
		this.current = store;
		this.currentMode = mode;
	}

	revertToLocal(): void {
		this.current = this.local;
		this.currentMode = 'local';
	}

	getActive(): IdentityStore {
		return this.current;
	}

	getLocal(): IdentityRepository {
		return this.local;
	}

	mode(): IdentityStoreMode {
		return this.currentMode;
	}
}
