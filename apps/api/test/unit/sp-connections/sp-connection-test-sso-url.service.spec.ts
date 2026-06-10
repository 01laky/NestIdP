import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SpConnectionTestSsoUrlService } from '@api/sp-connections/services/sp-connection-test-sso-url.service';
import { decodeRedirectBinding } from '@api/saml/utils/build-authn-request.util';
import {
	buildRedirectBindingSignedContent,
	extractRawQueryStringFromRequestUrl,
	parseRawSamlRedirectQuery,
	verifyRedirectBindingSignature,
} from '@api/saml/utils/saml-authn-request-redirect-signature.util';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';

/**
 * Unit spec for the operator "Test SSO URL" builder (Prompt 38 §8): URL construction, RelayState
 * handling, redirect-binding signing parameters and the encrypted-SAMLRequest variant. The HTTP
 * surface is covered by sp-connection-request-security.integration.spec.ts (API-SP-TEST-SSO-*).
 */
describe('SpConnectionTestSsoUrlService', () => {
	const prisma = {
		spConnection: { findUnique: jest.fn() },
		idpSettings: { findUnique: jest.fn() },
	};
	const configValues: Record<string, string | undefined> = {};
	const configService = {
		get: jest.fn((key: string) => configValues[key]),
	} as unknown as ConfigService;

	const service = new SpConnectionTestSsoUrlService(prisma as never, configService);

	const spId = 'c1234567890123456789012345';
	const sp = {
		id: spId,
		spEntityId: 'https://sp.example.com',
		spCertificate: null as string | null,
	};
	const envMaterial = getTestSigningMaterial('urn:test:sp:tsso-env-key');

	beforeEach(() => {
		jest.clearAllMocks();
		for (const key of Object.keys(configValues)) {
			delete configValues[key];
		}
		configValues.IDP_BASE_URL = 'http://localhost:3000';
		prisma.spConnection.findUnique.mockResolvedValue({ ...sp });
		prisma.idpSettings.findUnique.mockResolvedValue(null);
	});

	function decodedAuthnRequest(ssoUrl: string): string {
		const samlRequest = new URL(ssoUrl).searchParams.get('SAMLRequest');
		expect(samlRequest).toBeTruthy();
		return decodeRedirectBinding(samlRequest!);
	}

	it('API-SP-TSSO-U-01: unknown SP → NotFoundException', async () => {
		prisma.spConnection.findUnique.mockResolvedValue(null);
		await expect(service.buildTestSsoUrl(spId, {})).rejects.toThrow(NotFoundException);
	});

	it('API-SP-TSSO-U-02: default URL targets <base>/saml/sso with a decodable unsigned AuthnRequest', async () => {
		const result = await service.buildTestSsoUrl(spId, {});

		expect(result.ssoUrl.startsWith('http://localhost:3000/saml/sso?')).toBe(true);
		expect(result.signed).toBe(false);
		expect(result.encrypted).toBe(false);
		expect(result.spEntityId).toBe(sp.spEntityId);
		expect(result.warning).toBeUndefined();

		const url = new URL(result.ssoUrl);
		expect(url.searchParams.get('SigAlg')).toBeNull();
		expect(url.searchParams.get('Signature')).toBeNull();
		expect(url.searchParams.get('RelayState')).toBeNull();

		const xml = decodedAuthnRequest(result.ssoUrl);
		expect(xml).toContain(sp.spEntityId);
		expect(xml).toContain(result.authnRequestId);
		expect(xml).toContain('http://localhost:3000/saml/sso');
	});

	it('API-SP-TSSO-U-03: trailing slashes on IDP_BASE_URL are trimmed from the destination', async () => {
		configValues.IDP_BASE_URL = 'http://localhost:3000///';
		const result = await service.buildTestSsoUrl(spId, {});
		expect(result.ssoUrl.startsWith('http://localhost:3000/saml/sso?')).toBe(true);
	});

	it('API-SP-TSSO-U-04: RelayState is URL-encoded and round-trips through the query', async () => {
		const relayState = 'state with spaces & ampersand/slash';
		const result = await service.buildTestSsoUrl(spId, { relayState });
		const url = new URL(result.ssoUrl);
		expect(url.searchParams.get('RelayState')).toBe(relayState);
		// the raw query must carry the encoded form (no literal spaces/ampersands)
		expect(result.ssoUrl).toContain(`RelayState=${encodeURIComponent(relayState)}`);
	});

	it('API-SP-TSSO-U-05: signed=true without an SP certificate → BadRequestException', async () => {
		await expect(service.buildTestSsoUrl(spId, { signed: true })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-SP-TSSO-U-06: signed URL with SP_TEST_SIGNING_PRIVATE_KEY_PEM verifies and has no warning', async () => {
		prisma.spConnection.findUnique.mockResolvedValue({
			...sp,
			spCertificate: envMaterial.certPem,
		});
		configValues.SP_TEST_SIGNING_PRIVATE_KEY_PEM = envMaterial.privateKeyPem;

		const result = await service.buildTestSsoUrl(spId, { signed: true });
		expect(result.signed).toBe(true);
		expect(result.warning).toBeUndefined();

		const raw = parseRawSamlRedirectQuery(extractRawQueryStringFromRequestUrl(result.ssoUrl));
		expect(raw.sigAlg).toBeTruthy();
		expect(raw.signature).toBeTruthy();
		const ok = verifyRedirectBindingSignature({
			signedContent: buildRedirectBindingSignedContent({
				samlRequestRaw: raw.samlRequest!,
				sigAlgRaw: raw.sigAlg!,
			}),
			signatureBase64UrlEncoded: raw.signature!,
			sigAlgUri: decodeURIComponent(raw.sigAlg!),
			certificatePem: envMaterial.certPem,
		});
		expect(ok).toBe(true);
	});

	it('API-SP-TSSO-U-07: signed URL covers RelayState in the signed content', async () => {
		prisma.spConnection.findUnique.mockResolvedValue({
			...sp,
			spCertificate: envMaterial.certPem,
		});
		configValues.SP_TEST_SIGNING_PRIVATE_KEY_PEM = envMaterial.privateKeyPem;

		const result = await service.buildTestSsoUrl(spId, { signed: true, relayState: 'rs-1' });
		const raw = parseRawSamlRedirectQuery(extractRawQueryStringFromRequestUrl(result.ssoUrl));
		expect(raw.relayState).toBe(encodeURIComponent('rs-1'));

		const withRelayState = verifyRedirectBindingSignature({
			signedContent: buildRedirectBindingSignedContent({
				samlRequestRaw: raw.samlRequest!,
				relayStateRaw: raw.relayState,
				sigAlgRaw: raw.sigAlg!,
			}),
			signatureBase64UrlEncoded: raw.signature!,
			sigAlgUri: decodeURIComponent(raw.sigAlg!),
			certificatePem: envMaterial.certPem,
		});
		expect(withRelayState).toBe(true);

		// dropping RelayState from the signed content must break the signature (i.e. it was covered)
		const withoutRelayState = verifyRedirectBindingSignature({
			signedContent: buildRedirectBindingSignedContent({
				samlRequestRaw: raw.samlRequest!,
				sigAlgRaw: raw.sigAlg!,
			}),
			signatureBase64UrlEncoded: raw.signature!,
			sigAlgUri: decodeURIComponent(raw.sigAlg!),
			certificatePem: envMaterial.certPem,
		});
		expect(withoutRelayState).toBe(false);
	});

	it('API-SP-TSSO-U-08: signed URL without the env key falls back to an ephemeral key + warning', async () => {
		prisma.spConnection.findUnique.mockResolvedValue({
			...sp,
			spCertificate: envMaterial.certPem,
		});

		const result = await service.buildTestSsoUrl(spId, { signed: true });
		expect(result.warning).toBe('signed_with_ephemeral_key_verify_sp_cert_matches');

		const raw = parseRawSamlRedirectQuery(extractRawQueryStringFromRequestUrl(result.ssoUrl));
		expect(raw.sigAlg).toBeTruthy();
		expect(raw.signature).toBeTruthy();
		// the ephemeral key cannot match the stored SP certificate — exactly what the warning flags
		const ok = verifyRedirectBindingSignature({
			signedContent: buildRedirectBindingSignedContent({
				samlRequestRaw: raw.samlRequest!,
				sigAlgRaw: raw.sigAlg!,
			}),
			signatureBase64UrlEncoded: raw.signature!,
			sigAlgUri: decodeURIComponent(raw.sigAlg!),
			certificatePem: envMaterial.certPem,
		});
		expect(ok).toBe(false);
	});

	it('API-SP-TSSO-U-09: encrypted=true without an IdP encryption certificate → BadRequestException', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({ encryptionCertPem: null });
		await expect(service.buildTestSsoUrl(spId, { encrypted: true })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-SP-TSSO-U-10: encrypted=true wraps the AuthnRequest in xenc:EncryptedData', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			encryptionCertPem: envMaterial.certPem,
			encryptionKeyFamily: 'rsa',
		});

		const result = await service.buildTestSsoUrl(spId, { encrypted: true });
		expect(result.encrypted).toBe(true);
		expect(result.warning).toBeUndefined();
		const xml = decodedAuthnRequest(result.ssoUrl);
		expect(xml).toContain('xenc:EncryptedData');
		expect(xml).not.toContain('AuthnRequest ID="' + result.authnRequestId + '"');
	});

	it('API-SP-TSSO-U-11: an EC encryption key family raises the SP-compat warning', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			encryptionCertPem: envMaterial.certPem,
			encryptionKeyFamily: 'ec',
		});
		const result = await service.buildTestSsoUrl(spId, { encrypted: true });
		expect(result.warning).toBe('ec_key_agreement_sp_compat');
	});
});
