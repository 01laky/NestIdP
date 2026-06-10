/** IdP signing certificate generation — key types, XML-DSig algorithms, expiry (v1.4.7). */

import {
	DEFAULT_IDP_RSA_MODULUS_BITS,
	defaultNotAfterCalendarDate,
	IDP_CERT_DEFAULT_VALIDITY_DAYS,
	IDP_CERT_EC_CURVES,
	IDP_CERT_MAX_VALIDITY_YEARS,
	IDP_CERT_RSA_MODULUS_BITS,
	IdpCertCommonValidationError,
	validateIdpCertNotAfter as validateIdpCertNotAfterCommon,
} from './idp-cert-common.js';

export type IdpSigningKeyFamily = 'rsa' | 'ec';

export type IdpSigningRsaModulusBits = 2048 | 3072 | 4096;

export type IdpSigningEcCurve = 'P-256' | 'P-384' | 'P-521';

export const IDP_SIGNING_CERT_MAX_VALIDITY_YEARS = IDP_CERT_MAX_VALIDITY_YEARS;
export const IDP_SIGNING_CERT_DEFAULT_VALIDITY_DAYS = IDP_CERT_DEFAULT_VALIDITY_DAYS;
export const IDP_SIGNING_DEFAULT_SIGNATURE_ALGORITHM_ID = 'rsa-sha256';

export interface IdpSigningSignatureAlgorithmOption {
	id: string;
	xmlSignatureAlgorithm: string;
	xmlDigestAlgorithm: string;
	keyFamily: IdpSigningKeyFamily;
	nodeSignAlgorithm: string;
	labelKey: string;
	deprecated?: boolean;
}

export const IDP_SIGNING_SIGNATURE_ALGORITHMS: readonly IdpSigningSignatureAlgorithmOption[] = [
	{
		id: 'rsa-sha256',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
		xmlDigestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
		keyFamily: 'rsa',
		nodeSignAlgorithm: 'RSA-SHA256',
		labelKey: 'rsa-sha256',
	},
	{
		id: 'rsa-sha384',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384',
		xmlDigestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha384',
		keyFamily: 'rsa',
		nodeSignAlgorithm: 'RSA-SHA384',
		labelKey: 'rsa-sha384',
	},
	{
		id: 'rsa-sha512',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
		xmlDigestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha512',
		keyFamily: 'rsa',
		nodeSignAlgorithm: 'RSA-SHA512',
		labelKey: 'rsa-sha512',
	},
	{
		id: 'rsa-sha1',
		xmlSignatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
		xmlDigestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
		keyFamily: 'rsa',
		nodeSignAlgorithm: 'RSA-SHA1',
		labelKey: 'rsa-sha1',
		deprecated: true,
	},
	{
		id: 'ecdsa-sha256',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
		xmlDigestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
		keyFamily: 'ec',
		nodeSignAlgorithm: 'SHA256',
		labelKey: 'ecdsa-sha256',
	},
	{
		id: 'ecdsa-sha384',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384',
		xmlDigestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha384',
		keyFamily: 'ec',
		nodeSignAlgorithm: 'SHA384',
		labelKey: 'ecdsa-sha384',
	},
	{
		id: 'ecdsa-sha512',
		xmlSignatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512',
		xmlDigestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha512',
		keyFamily: 'ec',
		nodeSignAlgorithm: 'SHA512',
		labelKey: 'ecdsa-sha512',
	},
	{
		id: 'ecdsa-sha1',
		xmlSignatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#ecdsa-sha1',
		xmlDigestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
		keyFamily: 'ec',
		nodeSignAlgorithm: 'SHA1',
		labelKey: 'ecdsa-sha1',
		deprecated: true,
	},
] as const;

export interface StoredSigningCrypto {
	signingKeyFamily: IdpSigningKeyFamily;
	signingSignatureAlgorithmId: string;
	signingRsaModulusBits: number | null;
	signingEcCurve: IdpSigningEcCurve | null;
}

export interface GenerateIdpSigningCertRequestDto {
	keyFamily?: IdpSigningKeyFamily;
	rsaModulusBits?: IdpSigningRsaModulusBits;
	ecCurve?: IdpSigningEcCurve;
	signatureAlgorithmId?: string;
	/** Calendar date YYYY-MM-DD (UTC). */
	notAfter?: string;
}

export class IdpSigningCryptoValidationError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = 'IdpSigningCryptoValidationError';
	}
}

export function getIdpSigningSignatureOption(
	id: string,
): IdpSigningSignatureAlgorithmOption | undefined {
	return IDP_SIGNING_SIGNATURE_ALGORITHMS.find((entry) => entry.id === id);
}

export function listSignatureOptionsForKeyFamily(
	keyFamily: IdpSigningKeyFamily,
): IdpSigningSignatureAlgorithmOption[] {
	return IDP_SIGNING_SIGNATURE_ALGORITHMS.filter((entry) => entry.keyFamily === keyFamily);
}

export function assertCompatibleKeyAndSignature(
	keyFamily: IdpSigningKeyFamily,
	signatureAlgorithmId: string,
): IdpSigningSignatureAlgorithmOption {
	const option = getIdpSigningSignatureOption(signatureAlgorithmId);
	if (!option) {
		throw new IdpSigningCryptoValidationError(
			`Unknown signatureAlgorithmId: ${signatureAlgorithmId}`,
			'idp_signing_unknown_algorithm',
		);
	}
	if (option.keyFamily !== keyFamily) {
		throw new IdpSigningCryptoValidationError(
			`Signature algorithm ${signatureAlgorithmId} is not compatible with key family ${keyFamily}`,
			'idp_signing_key_algorithm_mismatch',
		);
	}
	return option;
}

export function validateIdpSigningCertNotAfter(isoDate: string, now = new Date()): string {
	try {
		return validateIdpCertNotAfterCommon(isoDate, now);
	} catch (error) {
		if (error instanceof IdpCertCommonValidationError) {
			const code = error.code.replace(/^idp_cert_/, 'idp_signing_');
			throw new IdpSigningCryptoValidationError(error.message, code);
		}
		throw error;
	}
}

export function resolveGenerateIdpSigningCertRequest(
	input: GenerateIdpSigningCertRequestDto = {},
	now = new Date(),
): {
	keyFamily: IdpSigningKeyFamily;
	rsaModulusBits: IdpSigningRsaModulusBits;
	ecCurve: IdpSigningEcCurve;
	signatureAlgorithmId: string;
	notAfter: string;
	signatureOption: IdpSigningSignatureAlgorithmOption;
} {
	const keyFamily: IdpSigningKeyFamily = input.keyFamily ?? 'rsa';
	const signatureAlgorithmId =
		input.signatureAlgorithmId ??
		(keyFamily === 'ec' ? 'ecdsa-sha256' : IDP_SIGNING_DEFAULT_SIGNATURE_ALGORITHM_ID);
	const signatureOption = assertCompatibleKeyAndSignature(keyFamily, signatureAlgorithmId);

	let rsaModulusBits: IdpSigningRsaModulusBits = DEFAULT_IDP_RSA_MODULUS_BITS;
	let ecCurve: IdpSigningEcCurve = 'P-256';

	if (keyFamily === 'rsa') {
		rsaModulusBits = input.rsaModulusBits ?? DEFAULT_IDP_RSA_MODULUS_BITS;
		if (!(IDP_CERT_RSA_MODULUS_BITS as readonly number[]).includes(rsaModulusBits)) {
			throw new IdpSigningCryptoValidationError(
				'rsaModulusBits must be 2048, 3072, or 4096',
				'idp_signing_bad_rsa_modulus',
			);
		}
		if (input.ecCurve !== undefined) {
			throw new IdpSigningCryptoValidationError(
				'ecCurve must not be set when keyFamily is rsa',
				'idp_signing_ec_curve_with_rsa',
			);
		}
	} else {
		ecCurve = input.ecCurve ?? 'P-256';
		if (!(IDP_CERT_EC_CURVES as readonly string[]).includes(ecCurve)) {
			throw new IdpSigningCryptoValidationError(
				'ecCurve must be P-256, P-384, or P-521',
				'idp_signing_bad_curve',
			);
		}
		if (input.rsaModulusBits !== undefined) {
			throw new IdpSigningCryptoValidationError(
				'rsaModulusBits must not be set when keyFamily is ec',
				'idp_signing_rsa_bits_with_ec',
			);
		}
	}

	const notAfter = validateIdpSigningCertNotAfter(
		input.notAfter ?? defaultNotAfterCalendarDate(now),
		now,
	);

	return {
		keyFamily,
		rsaModulusBits,
		ecCurve,
		signatureAlgorithmId,
		notAfter,
		signatureOption,
	};
}

export function toStoredSigningCrypto(
	resolved: ReturnType<typeof resolveGenerateIdpSigningCertRequest>,
): StoredSigningCrypto {
	return {
		signingKeyFamily: resolved.keyFamily,
		signingSignatureAlgorithmId: resolved.signatureAlgorithmId,
		signingRsaModulusBits: resolved.keyFamily === 'rsa' ? resolved.rsaModulusBits : null,
		signingEcCurve: resolved.keyFamily === 'ec' ? resolved.ecCurve : null,
	};
}

export function getDefaultGenerateIdpSigningCertRequest(
	now = new Date(),
): GenerateIdpSigningCertRequestDto {
	return {
		keyFamily: 'rsa',
		rsaModulusBits: DEFAULT_IDP_RSA_MODULUS_BITS,
		signatureAlgorithmId: IDP_SIGNING_DEFAULT_SIGNATURE_ALGORITHM_ID,
		notAfter: defaultNotAfterCalendarDate(now),
	};
}

export function buildIdpSigningGenerateOptionsForUi(now = new Date()) {
	return {
		keyFamilies: ['rsa', 'ec'] as const,
		rsaModulusBits: IDP_CERT_RSA_MODULUS_BITS,
		ecCurves: IDP_CERT_EC_CURVES,
		algorithms: IDP_SIGNING_SIGNATURE_ALGORITHMS,
		defaultRequest: getDefaultGenerateIdpSigningCertRequest(now),
		maxValidityYears: IDP_SIGNING_CERT_MAX_VALIDITY_YEARS,
		defaultValidityDays: IDP_SIGNING_CERT_DEFAULT_VALIDITY_DAYS,
	};
}

export function resolveSignatureAlgorithmIdForSigning(
	storedId: string | null | undefined,
): IdpSigningSignatureAlgorithmOption {
	if (storedId) {
		const option = getIdpSigningSignatureOption(storedId);
		if (option) {
			return option;
		}
	}
	return getIdpSigningSignatureOption(IDP_SIGNING_DEFAULT_SIGNATURE_ALGORITHM_ID)!;
}

export function defaultSignatureAlgorithmIdForKeyFamily(keyFamily: IdpSigningKeyFamily): string {
	return keyFamily === 'ec' ? 'ecdsa-sha256' : IDP_SIGNING_DEFAULT_SIGNATURE_ALGORITHM_ID;
}
