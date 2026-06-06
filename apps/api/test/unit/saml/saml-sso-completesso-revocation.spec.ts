import { BadRequestException } from '@nestjs/common';
import { SamlSsoService } from '@api/saml/services/saml-sso.service';

/**
 * completeSso checks the revocable SSO session BEFORE any other work, so the
 * other constructor dependencies are not exercised on this path.
 */
function makeService(isActive: boolean) {
	const ssoSessions = { isActive: jest.fn().mockResolvedValue(isActive) };
	const audit = { logResponseFailed: jest.fn() };
	const prisma = { samlSession: { findUnique: jest.fn() } };
	const service = new SamlSsoService(
		prisma as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		audit as never,
		ssoSessions as never,
	);
	return { service, ssoSessions, audit, prisma };
}

describe('SamlSsoService.completeSso — SSO session revocation', () => {
	it('API-SESS-REVOKE-02: terminated SSO session → 400 sso_session_terminated', async () => {
		const { service, audit, prisma } = makeService(false);
		await expect(service.completeSso('saml-session-1', 'user-1', 'sso-1')).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(audit.logResponseFailed).toHaveBeenCalledWith(
			'saml-session-1',
			'sso_session_terminated',
		);
		// Rejected before any SamlSession lookup.
		expect(prisma.samlSession.findUnique).not.toHaveBeenCalled();
	});

	it('no ssoSessionId → revocation check skipped (legacy/no-sid path proceeds to session lookup)', async () => {
		const { service, ssoSessions, prisma } = makeService(false);
		(prisma.samlSession.findUnique as jest.Mock).mockResolvedValue(null);
		// Without a sid we should fall through to the normal session lookup (which then fails as not found).
		await expect(service.completeSso('saml-session-1', 'user-1')).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(ssoSessions.isActive).not.toHaveBeenCalled();
		expect(prisma.samlSession.findUnique).toHaveBeenCalled();
	});
});
