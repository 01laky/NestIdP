import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DEFAULT_PASSWORD_HASH_ALGORITHM } from '@nestidp/shared';
import { EndUserAuthService, INVALID_CREDENTIALS_MESSAGE } from '@api/auth/services/end-user-auth.service';

jest.mock('@api/admin-auth/utils/password.util', () => ({
	verifyPasswordTimingSafe: jest.fn(),
}));

import { verifyPasswordTimingSafe } from '@api/admin-auth/utils/password.util';

describe('EndUserAuthService', () => {
	const identityRepository = {
		findUserByUsername: jest.fn(),
		findUserProfileById: jest.fn(),
	};
	const samlSessionBindService = {
		bindUserToSession: jest.fn(),
	};
	const prisma = {
		samlSession: {
			findUnique: jest.fn(),
		},
		idpSettings: {
			findUnique: jest.fn(),
		},
	};
	const idpSigningService = {
		hasSigningMaterial: jest.fn().mockResolvedValue(true),
	};
	const audit = {
		logLoginSuccess: jest.fn(),
		logLoginFailure: jest.fn(),
		logSamlBindFailure: jest.fn(),
		logUnsupportedAlgorithm: jest.fn(),
	};

	const service = new EndUserAuthService(
		identityRepository as never,
		samlSessionBindService as never,
		prisma as never,
		idpSigningService as never,
		audit as never,
	);

	const profile = {
		id: 'u1',
		username: 'alice',
		email: 'alice@example.com',
		displayName: 'Alice',
		active: true,
		groups: ['Engineering'],
		roles: ['User'],
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-AUTH-SVC-01: login success returns public user dto', async () => {
		identityRepository.findUserByUsername.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			active: true,
			passwordHash: 'hash',
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		});
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(true);
		identityRepository.findUserProfileById.mockResolvedValue(profile);

		const result = await service.login('alice', 'secret', { clientIp: '1.2.3.4' });
		expect(result.ok).toBe(true);
		expect(result.user.username).toBe('alice');
		expect(result.samlSessionBound).toBe(false);
		expect(audit.logLoginSuccess).toHaveBeenCalled();
	});

	it('API-AUTH-SVC-02: unknown username → 401 generic message', async () => {
		identityRepository.findUserByUsername.mockResolvedValue(null);
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(false);

		await expect(service.login('ghost', 'secret')).rejects.toThrow(UnauthorizedException);
		await expect(service.login('ghost', 'secret')).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
		expect(verifyPasswordTimingSafe).toHaveBeenCalledWith('secret', null);
	});

	it('API-AUTH-SVC-03: wrong password → 401 generic message', async () => {
		identityRepository.findUserByUsername.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			active: true,
			passwordHash: 'hash',
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		});
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(false);

		await expect(service.login('alice', 'wrong')).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
	});

	it('API-AUTH-SVC-04: inactive user → 401', async () => {
		identityRepository.findUserByUsername.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			active: false,
			passwordHash: 'hash',
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		});
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(false);

		await expect(service.login('alice', 'secret')).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
		expect(audit.logLoginFailure).toHaveBeenCalledWith('alice', expect.any(String), 'inactive');
	});

	it('API-AUTH-SVC-05: unsupported hash algorithm → 401 and audit warn', async () => {
		identityRepository.findUserByUsername.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			active: true,
			passwordHash: 'hash',
			passwordHashAlgorithm: 'argon2',
		});
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(false);

		await expect(service.login('alice', 'secret')).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
		expect(audit.logUnsupportedAlgorithm).toHaveBeenCalledWith('u1');
	});

	it('API-AUTH-SVC-06: login with samlSessionId binds session', async () => {
		identityRepository.findUserByUsername.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			active: true,
			passwordHash: 'hash',
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		});
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(true);
		identityRepository.findUserProfileById.mockResolvedValue(profile);
		samlSessionBindService.bindUserToSession.mockResolvedValue(undefined);

		const result = await service.login('alice', 'secret', {
			samlSessionId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
		});
		expect(result.samlSessionBound).toBe(true);
		expect(samlSessionBindService.bindUserToSession).toHaveBeenCalledWith(
			'clxxxxxxxxxxxxxxxxxxxxxxxxx',
			'u1',
		);
	});

	it('API-AUTH-SVC-07: SAML bind failure propagates and audits', async () => {
		identityRepository.findUserByUsername.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			active: true,
			passwordHash: 'hash',
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		});
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(true);
		samlSessionBindService.bindUserToSession.mockRejectedValue(
			new BadRequestException('SAML session expired'),
		);

		await expect(
			service.login('alice', 'secret', { samlSessionId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx' }),
		).rejects.toThrow(BadRequestException);
		expect(audit.logSamlBindFailure).toHaveBeenCalled();
	});

	it('API-AUTH-SVC-08: getMe returns mapped profile', async () => {
		identityRepository.findUserProfileById.mockResolvedValue(profile);
		await expect(service.getMe('u1')).resolves.toMatchObject({
			id: 'u1',
			username: 'alice',
		});
	});

	it('API-AUTH-SVC-09: getMe throws when profile inactive', async () => {
		identityRepository.findUserProfileById.mockResolvedValue({ ...profile, active: false });
		await expect(service.getMe('u1')).rejects.toThrow('Unauthorized');
	});

	it('API-AUTH-SVC-10: getSessionStatus with user and SAML session', async () => {
		identityRepository.findUserProfileById.mockResolvedValue(profile);
		prisma.samlSession.findUnique.mockResolvedValue({
			id: 'sess-1',
			userId: 'u1',
			expiresAt: new Date(Date.now() + 60_000),
			spConnection: { active: true },
		});
		prisma.idpSettings.findUnique.mockResolvedValue({
			id: 'default',
			entityId: 'http://localhost:3000',
		});

		const status = await service.getSessionStatus({
			userId: 'u1',
			samlSessionId: 'sess-1',
		});
		expect(status.authenticated).toBe(true);
		expect(status.user?.username).toBe('alice');
		expect(status.samlSession).toEqual({
			id: 'sess-1',
			bound: true,
			expired: false,
			spActive: true,
			readyToComplete: true,
		});
	});

	it('API-AUTH-SVC-12: getSessionStatus returns unauthenticated when userId profile inactive', async () => {
		identityRepository.findUserProfileById.mockResolvedValue({ ...profile, active: false });
		const status = await service.getSessionStatus({ userId: 'u1' });
		expect(status.authenticated).toBe(false);
		expect(status.user).toBeNull();
	});

	it('API-AUTH-SVC-13: getSessionStatus omits samlSession when row missing', async () => {
		prisma.samlSession.findUnique.mockResolvedValue(null);
		const status = await service.getSessionStatus({ samlSessionId: 'sess-missing' });
		expect(status.samlSession).toBeNull();
	});

	it('API-AUTH-SVC-14: getMe throws when profile missing', async () => {
		identityRepository.findUserProfileById.mockResolvedValue(null);
		await expect(service.getMe('missing')).rejects.toThrow('Unauthorized');
	});

	it('API-AUTH-SVC-15: login throws when profile disappears after password verify', async () => {
		identityRepository.findUserByUsername.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			active: true,
			passwordHash: 'hash',
			passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		});
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(true);
		identityRepository.findUserProfileById.mockResolvedValue(null);

		await expect(service.login('alice', 'secret')).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
	});

	it('API-AUTH-SVC-11: trims username before lookup', async () => {
		identityRepository.findUserByUsername.mockResolvedValue(null);
		(verifyPasswordTimingSafe as jest.Mock).mockResolvedValue(false);

		await expect(service.login('  alice  ', 'secret')).rejects.toThrow(UnauthorizedException);
		expect(identityRepository.findUserByUsername).toHaveBeenCalledWith('alice');
	});
});
