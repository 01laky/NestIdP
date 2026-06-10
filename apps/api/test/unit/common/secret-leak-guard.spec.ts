import { BadRequestException, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { RedactingExceptionFilter } from '@api/common/filters/redacting-exception.filter';
import { redactSecrets } from '@api/encryption/utils/redact-secret.util';
import { sanitizeAuditMetadata } from '@api/audit/utils/audit-metadata.util';

/**
 * §16 end-to-end secret-leak guard. Known sentinel secrets are driven through every formatting
 * path that can reach logs or HTTP clients — audit metadata (top-level AND nested), the
 * redactSecrets string scrubber, and the global RedactingExceptionFilter — and must never appear
 * in the output. SLG-05 proves the guard bites: a sentinel under a NON-denylisted metadata key
 * (the documented boundary of key-based redaction) IS detected as a leak by the same assertion.
 */

const SENTINELS = {
	bcryptHash: '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7BcwsZQk6L0kobsh3Tt7Gx4WJEY1NHK',
	encryptionKey: '0123456789abcdef0123456789abcdefSENTINEL',
	oauthClientSecret: 'oauth-cs-SENTINEL-94c1b2cf2d',
	proxyPassword: 'proxy-pw-SENTINEL-d41d8cd98f',
	sessionCookie: 'nestidp_admin=sess-SENTINEL-1f3870be27.sig-SENTINEL',
	privateKeyPem:
		'-----BEGIN PRIVATE KEY-----\nMIIPEMSENTINELBODYxyz123\n-----END PRIVATE KEY-----',
} as const;

const SENTINEL_VALUES = Object.values(SENTINELS);

function expectNoSentinel(serialized: string): void {
	for (const sentinel of SENTINEL_VALUES) {
		// PEM spans lines; JSON.stringify escapes them — check a distinctive fragment instead.
		const needle = sentinel.includes('\n') ? 'MIIPEMSENTINELBODY' : sentinel;
		expect(serialized).not.toContain(needle);
	}
}

describe('secret-leak guard (SLG, §16)', () => {
	it('SLG-01: audit metadata drops every sentinel at top level AND nested', () => {
		const sanitized = sanitizeAuditMetadata({
			// top-level, under production-realistic key names
			passwordHash: SENTINELS.bcryptHash,
			encryptionKey: SENTINELS.encryptionKey,
			oauthClientSecret: SENTINELS.oauthClientSecret,
			proxyPassword: SENTINELS.proxyPassword,
			sessionToken: SENTINELS.sessionCookie,
			signingPrivateKeyPem: SENTINELS.privateKeyPem,
			// nested (§5.A12 regression shape)
			details: {
				a: { password: SENTINELS.bcryptHash },
				connection: { bearerToken: SENTINELS.oauthClientSecret },
				deep: [{ clientSecretEncrypted: SENTINELS.encryptionKey }],
			},
			// non-secret context survives
			username: 'alice',
		});
		const serialized = JSON.stringify(sanitized);
		expectNoSentinel(serialized);
		expect(serialized).toContain('alice');
	});

	it('SLG-02: redactSecrets scrubs every sentinel in the wire shapes errors actually carry', () => {
		const carriers = [
			`token endpoint: HTTP 400 (invalid_client: client_secret=${SENTINELS.oauthClientSecret} rejected)`,
			`{"client_secret":"${SENTINELS.oauthClientSecret}","grant_type":"client_credentials"}`,
			`fetch failed: Authorization: Bearer ${SENTINELS.oauthClientSecret}`,
			`proxy refused: Proxy-Authorization: Basic ${Buffer.from(`u:${SENTINELS.proxyPassword}`).toString('base64')}`,
			`connect failed for http://syncuser:${SENTINELS.proxyPassword}@proxy.internal:3128`,
			`{"password":"${SENTINELS.bcryptHash}"}`,
			`bind failed: password=${SENTINELS.encryptionKey}`,
		];
		for (const carrier of carriers) {
			expectNoSentinel(redactSecrets(carrier));
		}
	});

	it('SLG-03: the global exception filter redacts sentinels in HttpException payloads (string + object + nested)', () => {
		const sent: unknown[] = [];
		const filter = new RedactingExceptionFilter({
			httpAdapter: {
				reply: (_res: unknown, body: unknown) => {
					sent.push(body);
				},
				isHeadersSent: () => false,
			},
		} as unknown as HttpAdapterHost);
		const host = {
			switchToHttp: () => ({
				getResponse: () => ({}),
				getRequest: () => ({}),
			}),
			getArgByIndex: () => ({}),
			getType: () => 'http',
		} as unknown as ArgumentsHost;

		filter.catch(
			new BadRequestException(`token exchange failed: client_secret=${SENTINELS.oauthClientSecret}`),
			host,
		);
		filter.catch(
			new HttpException(
				{
					statusCode: 502,
					message: `upstream: Authorization: Bearer ${SENTINELS.oauthClientSecret}`,
					detail: { url: `http://u:${SENTINELS.proxyPassword}@proxy.internal` },
				},
				502,
			),
			host,
		);
		expect(sent.length).toBe(2);
		expectNoSentinel(JSON.stringify(sent));
	});

	it('SLG-04: the filter keeps a plain Error generic (no message leak at all)', () => {
		const sent: unknown[] = [];
		const filter = new RedactingExceptionFilter({
			httpAdapter: {
				reply: (_res: unknown, body: unknown) => {
					sent.push(body);
				},
				isHeadersSent: () => false,
			},
		} as unknown as HttpAdapterHost);
		const host = {
			switchToHttp: () => ({
				getResponse: () => ({}),
				getRequest: () => ({}),
			}),
			getArgByIndex: () => ({}),
			getType: () => 'http',
		} as unknown as ArgumentsHost;

		filter.catch(new Error(`boom with ${SENTINELS.encryptionKey}`), host);
		const serialized = JSON.stringify(sent);
		expectNoSentinel(serialized);
		expect(serialized).toContain('Internal server error');
	});

	it('SLG-05: the guard bites — a sentinel under a NON-denylisted key leaks through key-based metadata redaction', () => {
		// This pins the documented boundary of sanitizeAuditMetadata (it redacts by KEY NAME, §5.A12):
		// if someone stores a secret under an innocuous key, the leak-guard assertion catches it. If
		// this test ever starts failing because the sentinel is gone, the sanitizer gained value-based
		// redaction — update SLG-01 to cover the new mechanism and tighten this expectation.
		const sanitized = sanitizeAuditMetadata({ flobble: SENTINELS.oauthClientSecret });
		expect(JSON.stringify(sanitized)).toContain(SENTINELS.oauthClientSecret);
	});
});
