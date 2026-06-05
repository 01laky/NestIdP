import { SAML_SSO_PATH } from '@nestidp/shared';
import { assertValidAcsUrl as assertValidAcsUrlImpl } from '../../common/utils/acs-url.util';

export { assertValidAcsUrl } from '../../common/utils/acs-url.util';
export { AcsUrlValidationError } from '../../common/utils/acs-url.util';

export function normalizeUrlForComparison(url: string): string {
	const parsed = new URL(url);
	const path = parsed.pathname.replace(/\/+$/, '') || '/';
	return `${parsed.origin}${path}`;
}

export function getExpectedSsoDestination(idpBaseUrl: string): string {
	const base = idpBaseUrl.replace(/\/+$/, '');
	return normalizeUrlForComparison(`${base}${SAML_SSO_PATH}`);
}

/** @deprecated Use assertValidAcsUrl from common/acs-url.util */
export function validateAcsUrl(acsUrl: string, nodeEnv: string): void {
	assertValidAcsUrlImpl(acsUrl, nodeEnv);
}
