import { AdminAuthAuditService } from '@api/admin-auth/services/admin-auth-audit.service';
import type { AuditRecordInput } from '@api/audit/services/audit-persistence.service';
import { AuditPersistenceService } from '@api/audit/services/audit-persistence.service';

describe('AdminAuthAuditService (API-AUD-ADM-RM)', () => {
	const audit = { recordSafe: jest.fn() };
	let service: AdminAuthAuditService;

	beforeEach(() => {
		jest.clearAllMocks();
		service = new AdminAuthAuditService(audit as unknown as AuditPersistenceService);
	});

	it('API-AUD-ADM-RM-04: logLoginSuccess without rememberMe omits metadata', () => {
		service.logLoginSuccess('a1', 'admin', '127.0.0.1', false);
		expect(audit.recordSafe).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'admin_login_success',
				metadata: undefined,
			}),
		);
	});

	it('API-AUD-ADM-RM-05: logLoginSuccess with rememberMe sets metadata', () => {
		service.logLoginSuccess('a1', 'admin', '127.0.0.1', true);
		expect(audit.recordSafe).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { rememberMe: true },
			}),
		);
	});

	it('API-AUD-ADM-RM-06: logLoginFailure never includes rememberMe metadata', () => {
		service.logLoginFailure('admin', '10.0.0.1');
		const input = audit.recordSafe.mock.calls[0]![0] as AuditRecordInput;
		expect(input.event).toBe('admin_login_failure');
		expect(input.metadata).toBeUndefined();
	});
});
