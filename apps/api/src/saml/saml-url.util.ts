import { SAML_SSO_PATH } from '@nestidp/shared';

export function normalizeUrlForComparison(url: string): string {
	const parsed = new URL(url);
	const path = parsed.pathname.replace(/\/+$/, '') || '/';
	return `${parsed.origin}${path}`;
}

export function getExpectedSsoDestination(idpBaseUrl: string): string {
	const base = idpBaseUrl.replace(/\/+$/, '');
	return normalizeUrlForComparison(`${base}${SAML_SSO_PATH}`);
}

export function validateAcsUrl(acsUrl: string, nodeEnv: string): void {
	let parsed: URL;
	try {
		parsed = new URL(acsUrl);
	} catch {
		throw new Error('Invalid ACS URL');
	}
	if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
		throw new Error('ACS URL must use HTTPS in production');
	}
}
