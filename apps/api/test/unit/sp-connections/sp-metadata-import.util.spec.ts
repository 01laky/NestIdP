import { buildSpMetadataImportResult } from '@api/sp-connections/utils/sp-metadata-import.util';
import type { SpMetadataParseResult } from '@api/saml/utils/sp-metadata.util';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';

const REAL_CERT = getTestSigningMaterial('urn:test:resolver').certPem.trim();
const REAL_CERT_2 = getTestSigningMaterial('urn:test:resolver-2').certPem.trim();
const INVALID_CERT = '-----BEGIN CERTIFICATE-----\nbm90LWEtY2VydA==\n-----END CERTIFICATE-----';

const RED = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const NOW = new Date('2026-06-13T00:00:00.000Z');

function parseResult(over: Partial<SpMetadataParseResult> = {}): SpMetadataParseResult {
	return {
		valid: true,
		entityId: 'https://sp.example.com/sp',
		acs: [],
		slo: { redirect: null, post: null, soap: null },
		nameIdFormats: [],
		signingCertificates: [],
		authnRequestsSigned: false,
		wantAssertionsSigned: false,
		signed: false,
		validUntil: null,
		entityCount: 1,
		...over,
	};
}

function codes(result: ReturnType<typeof buildSpMetadataImportResult>): string[] {
	return result.warnings.map((w) => w.code);
}

describe('buildSpMetadataImportResult (Prompt 42)', () => {
	it('SPM-PREFILL-01: ACS pick — isDefault wins, else lowest index, POST preferred over Redirect', () => {
		// Two POST endpoints (one default) + a redirect: the default POST is chosen.
		const r = buildSpMetadataImportResult(
			parseResult({
				acs: [
					{ binding: RED, location: 'https://sp/acs-redirect', index: 0, isDefault: true },
					{ binding: POST, location: 'https://sp/acs-post-2', index: 2, isDefault: false },
					{ binding: POST, location: 'https://sp/acs-post-1', index: 1, isDefault: true },
				],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.acsUrl).toBe('https://sp/acs-post-1');
		expect(codes(r)).not.toContain('acs_non_post_only');
	});

	it('SPM-PREFILL-01b: POST preferred even when a Redirect ACS is the default', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				acs: [
					{ binding: RED, location: 'https://sp/redirect', index: 0, isDefault: true },
					{ binding: POST, location: 'https://sp/post', index: 5, isDefault: false },
				],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.acsUrl).toBe('https://sp/post');
	});

	it('SPM-PREFILL-01c: only non-POST ACS → chosen + acs_non_post_only warning', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				acs: [{ binding: RED, location: 'https://sp/redirect', index: 0, isDefault: false }],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.acsUrl).toBe('https://sp/redirect');
		expect(codes(r)).toContain('acs_non_post_only');
	});

	it('SPM-PREFILL-01d: no ACS → null + no_acs warning', () => {
		const r = buildSpMetadataImportResult(parseResult({ acs: [] }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(r.acsUrl).toBeNull();
		expect(codes(r)).toContain('no_acs');
	});

	it('SPM-PREFILL-02: NameID — first supported chosen; unsupported-only → null + warning', () => {
		const supported = buildSpMetadataImportResult(
			parseResult({
				nameIdFormats: [
					'urn:something:custom',
					'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
				],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(supported.nameIdFormat).toBe('urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
		expect(codes(supported)).not.toContain('unsupported_nameid_format');

		const unsupported = buildSpMetadataImportResult(
			parseResult({ nameIdFormats: ['urn:something:custom'] }),
			{ now: NOW, entityIdConflict: null },
		);
		expect(unsupported.nameIdFormat).toBeNull();
		expect(codes(unsupported)).toContain('unsupported_nameid_format');
		expect(unsupported.warnings.find((w) => w.code === 'unsupported_nameid_format')?.detail).toBe(
			'urn:something:custom',
		);
	});

	it('SPM-PREFILL-02b: absent NameID → null, no warning (UI keeps default)', () => {
		const r = buildSpMetadataImportResult(parseResult({ nameIdFormats: [] }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(r.nameIdFormat).toBeNull();
		expect(codes(r)).not.toContain('unsupported_nameid_format');
	});

	it('SPM-PREFILL-03: invalid cert dropped with invalid_signing_certificate warning', () => {
		const r = buildSpMetadataImportResult(parseResult({ signingCertificates: [INVALID_CERT] }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(r.spCertificate).toBeNull();
		expect(r.signingCertificates).toEqual([]);
		expect(codes(r)).toContain('invalid_signing_certificate');
	});

	it('SPM-PREFILL-03b: valid certs kept in order; first becomes spCertificate', () => {
		const r = buildSpMetadataImportResult(
			parseResult({ signingCertificates: [REAL_CERT, INVALID_CERT, REAL_CERT_2] }),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.signingCertificates).toEqual([REAL_CERT, REAL_CERT_2]);
		expect(r.spCertificate).toBe(REAL_CERT);
		// Some cert was valid, so no invalid warning.
		expect(codes(r)).not.toContain('invalid_signing_certificate');
	});

	it('SPM-PREFILL-03c: no certs → no_signing_certificate warning', () => {
		const r = buildSpMetadataImportResult(parseResult({ signingCertificates: [] }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(codes(r)).toContain('no_signing_certificate');
	});

	it('SPM-PREFILL-04: entityId conflict is passed through', () => {
		const r = buildSpMetadataImportResult(parseResult(), {
			now: NOW,
			entityIdConflict: { id: 'c123', name: 'Existing SP' },
		});
		expect(r.entityIdConflict).toEqual({ id: 'c123', name: 'Existing SP' });
	});

	it('SPM-PREFILL-05: expired validUntil → metadata_expired warning with detail', () => {
		const r = buildSpMetadataImportResult(parseResult({ validUntil: '2020-01-01T00:00:00Z' }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(codes(r)).toContain('metadata_expired');
		expect(r.warnings.find((w) => w.code === 'metadata_expired')?.detail).toBe(
			'2020-01-01T00:00:00Z',
		);
	});

	it('SPM-PREFILL-05b: future validUntil → no expiry warning; unparseable validUntil ignored', () => {
		expect(
			codes(
				buildSpMetadataImportResult(parseResult({ validUntil: '2099-01-01T00:00:00Z' }), {
					now: NOW,
					entityIdConflict: null,
				}),
			),
		).not.toContain('metadata_expired');
		expect(
			codes(
				buildSpMetadataImportResult(parseResult({ validUntil: 'not-a-date' }), {
					now: NOW,
					entityIdConflict: null,
				}),
			),
		).not.toContain('metadata_expired');
	});

	it('SPM-PREFILL-06: SLO redirect preferred over POST; soap → sloSoapUrl; none → no_slo', () => {
		const both = buildSpMetadataImportResult(
			parseResult({
				slo: { redirect: 'https://sp/r', post: 'https://sp/p', soap: 'https://sp/s' },
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(both.sloUrl).toBe('https://sp/r');
		expect(both.sloSoapUrl).toBe('https://sp/s');
		expect(codes(both)).not.toContain('no_slo');

		const postOnly = buildSpMetadataImportResult(
			parseResult({ slo: { redirect: null, post: 'https://sp/p', soap: null } }),
			{ now: NOW, entityIdConflict: null },
		);
		expect(postOnly.sloUrl).toBe('https://sp/p');

		const none = buildSpMetadataImportResult(parseResult(), { now: NOW, entityIdConflict: null });
		expect(none.sloUrl).toBeNull();
		expect(codes(none)).toContain('no_slo');
	});

	it('SPM-PREFILL-07: AuthnRequestsSigned with no valid cert → authn_requests_signed_no_cert', () => {
		const noCert = buildSpMetadataImportResult(parseResult({ authnRequestsSigned: true }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(noCert.authnRequestsSigned).toBe(true);
		expect(codes(noCert)).toContain('authn_requests_signed_no_cert');

		const withCert = buildSpMetadataImportResult(
			parseResult({ authnRequestsSigned: true, signingCertificates: [REAL_CERT] }),
			{ now: NOW, entityIdConflict: null },
		);
		expect(codes(withCert)).not.toContain('authn_requests_signed_no_cert');
	});

	it('SPM-PREFILL-08: multiple entities → multiple_entities warning', () => {
		const r = buildSpMetadataImportResult(parseResult({ entityCount: 3 }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(codes(r)).toContain('multiple_entities');
	});

	it('SPM-PREFILL-09: invalid parse result → valid:false passthrough, empty prefill, no warnings', () => {
		const r = buildSpMetadataImportResult(parseResult({ valid: false, entityId: null }), {
			now: NOW,
			entityIdConflict: { id: 'x', name: 'y' },
		});
		expect(r.valid).toBe(false);
		expect(r.entityId).toBeNull();
		expect(r.acsUrl).toBeNull();
		expect(r.warnings).toEqual([]);
		expect(r.entityIdConflict).toBeNull();
	});

	it('SPM-PREFILL-10: ACS tie-break — equal POST endpoints, none default → document order wins', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				acs: [
					{ binding: POST, location: 'https://sp/first', index: null, isDefault: false },
					{ binding: POST, location: 'https://sp/second', index: null, isDefault: false },
				],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.acsUrl).toBe('https://sp/first');
	});

	it('SPM-PREFILL-10b: ACS with an index sorts before one without an index', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				acs: [
					{ binding: POST, location: 'https://sp/noindex', index: null, isDefault: false },
					{ binding: POST, location: 'https://sp/idx3', index: 3, isDefault: false },
				],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.acsUrl).toBe('https://sp/idx3');
	});

	it('SPM-PREFILL-11: NameID picks the FIRST supported format in document order', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				nameIdFormats: [
					'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
					'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.nameIdFormat).toBe('urn:oasis:names:tc:SAML:2.0:nameid-format:transient');
	});

	it('SPM-PREFILL-12: validUntil exactly equal to now is NOT treated as expired (strict <)', () => {
		const r = buildSpMetadataImportResult(parseResult({ validUntil: NOW.toISOString() }), {
			now: NOW,
			entityIdConflict: null,
		});
		expect(codes(r)).not.toContain('metadata_expired');
	});

	it('SPM-PREFILL-13: a worst-case document accumulates every independent warning', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				acs: [{ binding: RED, location: 'https://sp/redirect', index: 0, isDefault: false }],
				nameIdFormats: ['urn:custom:unsupported'],
				signingCertificates: [INVALID_CERT],
				authnRequestsSigned: true,
				slo: { redirect: null, post: null, soap: null },
				validUntil: '2020-01-01T00:00:00Z',
				entityCount: 2,
			}),
			{ now: NOW, entityIdConflict: { id: 'c1', name: 'Dup' } },
		);
		expect(codes(r).sort()).toEqual(
			[
				'acs_non_post_only',
				'authn_requests_signed_no_cert',
				'invalid_signing_certificate',
				'metadata_expired',
				'multiple_entities',
				'no_slo',
				'unsupported_nameid_format',
			].sort(),
		);
		// Still produces a usable prefill (the non-POST ACS is chosen, conflict surfaced).
		expect(r.acsUrl).toBe('https://sp/redirect');
		expect(r.entityIdConflict).toEqual({ id: 'c1', name: 'Dup' });
	});

	it('SPM-PREFILL-14: a clean document produces zero warnings', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				acs: [{ binding: POST, location: 'https://sp/acs', index: 0, isDefault: true }],
				nameIdFormats: ['urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'],
				signingCertificates: [REAL_CERT],
				authnRequestsSigned: true,
				slo: { redirect: 'https://sp/slo', post: null, soap: 'https://sp/soap' },
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.warnings).toEqual([]);
		expect(r.spCertificate).toBe(REAL_CERT);
		expect(r.acsUrl).toBe('https://sp/acs');
		expect(r.sloUrl).toBe('https://sp/slo');
		expect(r.sloSoapUrl).toBe('https://sp/soap');
	});

	it('SPM-PREFILL-15: signed + wantAssertionsSigned flags pass through; acsOptions always returned', () => {
		const r = buildSpMetadataImportResult(
			parseResult({
				signed: true,
				wantAssertionsSigned: true,
				acs: [{ binding: POST, location: 'https://sp/acs', index: 0, isDefault: true }],
			}),
			{ now: NOW, entityIdConflict: null },
		);
		expect(r.signed).toBe(true);
		expect(r.wantAssertionsSigned).toBe(true);
		expect(r.acsOptions).toHaveLength(1);
	});
});
