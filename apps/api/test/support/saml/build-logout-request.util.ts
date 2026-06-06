import { execSync } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import { applyNestIdpXmlCryptoExtensions } from '@api/saml/xml-crypto-extended-algorithms';
import {
	buildSignedAuthnRequestRedirectQuery,
	type SignedAuthnRequestRedirectQuery,
} from '@api/saml/utils/sign-authn-request-redirect.util';

export interface LogoutRequestOptions {
	id?: string;
	issuer?: string;
	destination?: string;
	nameId?: string;
	nameIdFormat?: string;
	sessionIndex?: string | string[];
	issueInstant?: string;
	notOnOrAfter?: string;
	includeNameId?: boolean;
	encryptedId?: boolean;
}

export function buildLogoutRequestXml(options: LogoutRequestOptions = {}): string {
	const id = options.id ?? `_logout-${Date.now()}`;
	const issuer = options.issuer ?? 'urn:test:sp';
	const destination = options.destination ?? 'http://localhost:3000/saml/slo';
	const issueInstant = options.issueInstant ?? new Date().toISOString();
	const nameId = options.nameId ?? 'user@example.com';
	const nameIdFormat =
		options.nameIdFormat ?? 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
	const sessionIndexes = Array.isArray(options.sessionIndex)
		? options.sessionIndex
		: options.sessionIndex
			? [options.sessionIndex]
			: [];

	const notOnOrAfterAttr = options.notOnOrAfter ? ` NotOnOrAfter="${options.notOnOrAfter}"` : '';
	const subject = options.encryptedId
		? '<saml:EncryptedID><xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"/></saml:EncryptedID>'
		: options.includeNameId === false
			? ''
			: `<saml:NameID Format="${nameIdFormat}">${escapeXml(nameId)}</saml:NameID>`;
	const sessionIndexXml = sessionIndexes
		.map((si) => `<samlp:SessionIndex>${escapeXml(si)}</samlp:SessionIndex>`)
		.join('');

	return `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${issueInstant}" Destination="${destination}"${notOnOrAfterAttr}><saml:Issuer>${escapeXml(issuer)}</saml:Issuer>${subject}${sessionIndexXml}</samlp:LogoutRequest>`;
}

export function encodeLogoutRedirect(xml: string): string {
	return deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64');
}

export function buildPlainLogoutRedirect(options: LogoutRequestOptions = {}): {
	samlRequest: string;
	xml: string;
} {
	const xml = buildLogoutRequestXml(options);
	return { samlRequest: encodeURIComponent(encodeLogoutRedirect(xml)), xml };
}

export function buildSignedLogoutRedirect(
	options: LogoutRequestOptions & { spPrivateKeyPem: string; relayState?: string },
): SignedAuthnRequestRedirectQuery & { xml: string } {
	const xml = buildLogoutRequestXml(options);
	const samlRequestRaw = encodeURIComponent(encodeLogoutRedirect(xml));
	const signed = buildSignedAuthnRequestRedirectQuery({
		samlRequestRaw,
		spPrivateKeyPem: options.spPrivateKeyPem,
		relayStateRaw: options.relayState ? encodeURIComponent(options.relayState) : undefined,
	});
	return { ...signed, xml };
}

export function buildPlainLogoutPostBody(options: LogoutRequestOptions = {}): {
	samlRequest: string;
	xml: string;
} {
	const xml = buildLogoutRequestXml(options);
	return { samlRequest: Buffer.from(xml, 'utf8').toString('base64'), xml };
}

export function buildSignedLogoutPostBody(
	options: LogoutRequestOptions & { spPrivateKeyPem: string; spCertificatePem: string },
): { samlRequest: string; xml: string } {
	const id = options.id ?? `_logout-signed-${Date.now()}`;
	const xml = buildLogoutRequestXml({ ...options, id });
	const sig = new SignedXml({
		privateKey: createPrivateKey({ key: options.spPrivateKeyPem, format: 'pem' }),
		publicCert: options.spCertificatePem,
		signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
		canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
	});
	applyNestIdpXmlCryptoExtensions(sig);
	sig.addReference({
		xpath: `//*[@ID='${id}']`,
		transforms: [
			'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
			'http://www.w3.org/2001/10/xml-exc-c14n#',
		],
		digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
	});
	sig.computeSignature(xml, {
		location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
	});
	const signedXml = sig.getSignedXml();
	return { samlRequest: Buffer.from(signedXml, 'utf8').toString('base64'), xml: signedXml };
}

export function generateTestSpSigningKeyPair(cn = 'test-sp'): {
	privateKeyPem: string;
	certPem: string;
} {
	const { privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	return selfSignCert(privateKey, cn);
}

export function generateTestEcSigningKeyPair(cn = 'test-ec-idp'): {
	privateKeyPem: string;
	certPem: string;
} {
	const { privateKey } = generateKeyPairSync('ec', {
		namedCurve: 'prime256v1',
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	return selfSignCert(privateKey, cn);
}

function selfSignCert(
	privateKeyPem: string,
	cn: string,
): { privateKeyPem: string; certPem: string } {
	const tmp = mkdtempSync(join(tmpdir(), 'nestidp-sp-logout-'));
	try {
		const keyPath = join(tmp, 'key.pem');
		const certPath = join(tmp, 'cert.pem');
		writeFileSync(keyPath, privateKeyPem);
		execSync(
			`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=${cn}" -nodes 2>/dev/null`,
			{ stdio: 'pipe' },
		);
		return { privateKeyPem, certPem: readFileSync(certPath, 'utf8') };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
