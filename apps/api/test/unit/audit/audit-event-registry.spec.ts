import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
	AUDIT_EVENT_NAMES,
	AUDIT_EVENT_NAME_PATTERN,
	isAuditEventName,
} from '@api/audit/audit-event-names';

/**
 * §15 audit-event registry parity. Membership of persisted events is enforced by the COMPILER
 * (AuditRecordInput.event: AuditEventName) — these tests cover what types can't: the naming
 * scheme, dead registry entries, and stdout-only log events drifting from the scheme.
 */

const SRC_ROOT = join(__dirname, '../../../src');

function readAllSources(): string {
	const chunks: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				walk(path);
			} else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
				chunks.push(readFileSync(path, 'utf8'));
			}
		}
	};
	walk(SRC_ROOT);
	return chunks.join('\n');
}

const allSource = readAllSources();

describe('audit-event registry (AUDIT-REG, §15)', () => {
	it('AUDIT-REG-01: every registry name matches the snake_case naming scheme', () => {
		for (const name of AUDIT_EVENT_NAMES) {
			expect(name).toMatch(AUDIT_EVENT_NAME_PATTERN);
		}
	});

	it('AUDIT-REG-02: the registry has no duplicates', () => {
		expect(new Set(AUDIT_EVENT_NAMES).size).toBe(AUDIT_EVENT_NAMES.length);
	});

	it('AUDIT-REG-03: every registry name is actually emitted somewhere in src (no dead entries)', () => {
		// Templated emit sites interpolate a per-kind/per-scope segment — expand the known families.
		const templateCandidates = (name: string): string[] => {
			const candidates = [`'${name}'`];
			const kind = name.match(/^idp_(signing|encryption)_(.+)$/);
			if (kind) {
				candidates.push(`\`idp_\${kind}_${kind[2]}\``);
			}
			const scope = name.match(/^(admin|end_user)_(.+)$/);
			if (scope) {
				candidates.push(`\`\${scope}_${scope[2]}\``, `\`\${surface}_${scope[2]}\``);
			}
			return candidates;
		};
		const dead = AUDIT_EVENT_NAMES.filter(
			(name) => !templateCandidates(name).some((c) => allSource.includes(c)),
		);
		expect(dead).toEqual([]);
	});

	it('AUDIT-REG-04: every `event:` literal in src (audit AND stdout-log) follows the scheme — no dotted names', () => {
		const literals = [...allSource.matchAll(/event: '([^']+)'/g)].map((m) => m[1]);
		expect(literals.length).toBeGreaterThan(80); // sanity: the scan actually sees the codebase
		const offenders = literals.filter((l) => !AUDIT_EVENT_NAME_PATTERN.test(l));
		expect(offenders).toEqual([]);
	});

	it('AUDIT-REG-05: the §15 offenders stay fixed (dotted identity.*, connect-as-test, rotation word-order)', () => {
		expect(allSource).not.toMatch(/identity\.(user|group|role)\.(created|updated|deleted)/);
		expect(allSource).not.toContain("event: 'identity_db_test'");
		// The flipped word order was `idp_<kind>_rotation_auto_*` (vs the `..._auto_rotation_*` family).
		// The stdout-only notifier family `cert_rotation_auto_*` is a different, consistent prefix.
		expect(allSource).not.toMatch(/idp_(signing|encryption|\$\{kind\})_rotation_auto_/);
	});

	it('AUDIT-REG-06: isAuditEventName guards membership', () => {
		expect(isAuditEventName('admin_login_success')).toBe(true);
		expect(isAuditEventName('identity.user.created')).toBe(false);
		expect(isAuditEventName('not_a_real_event')).toBe(false);
	});

	it('AUDIT-REG-07: templated emit families expand only to registry members', () => {
		for (const kind of ['signing', 'encryption'] as const) {
			for (const suffix of [
				'auto_rotation_started',
				'auto_rotation_completed',
				'auto_rotation_due_soon',
				'auto_rotation_failed',
				'auto_rotation_autodisabled',
				'cert_unparseable',
			]) {
				expect(isAuditEventName(`idp_${kind}_${suffix}`)).toBe(true);
			}
		}
		expect(isAuditEventName('idp_auto_rotation_deferred_boot')).toBe(true);
		for (const scope of ['admin', 'end_user'] as const) {
			expect(isAuditEventName(`${scope}_login_locked`)).toBe(true);
			expect(isAuditEventName(`${scope}_account_unlocked`)).toBe(true);
			expect(isAuditEventName(`${scope}_login_rate_limited`)).toBe(true);
		}
	});
});
