/** IdP encryption certificate — key types, XML Enc key transport, expiry (v1.5.0). */

import type { IdpCertEcCurve, IdpCertKeyFamily, IdpCertRsaModulusBits } from './idp-cert-common.js';
import {
	DEFAULT_IDP_RSA_MODULUS_BITS,
	defaultNotAfterCalendarDate,
	IDP_CERT_DEFAULT_VALIDITY_DAYS,
	IDP_CERT_EC_CURVES,
	IDP_CERT_MAX_VALIDITY_YEARS,
	IDP_CERT_RSA_MODULUS_BITS,
	IdpCertCommonValidationError,
	validateIdpCertNotAfter,
} from './idp-cert-common.js';

export type { IdpCertKeyFamily, IdpCertRsaModulusBits, IdpCertEcCurve };

export const IDP_ENCRYPTION_CERT_MAX_VALIDITY_YEARS = IDP_CERT_MAX_VALIDITY_YEARS;
export const IDP_ENCRYPTION_CERT_DEFAULT_VALIDITY_DAYS = IDP_CERT_DEFAULT_VALIDITY_DAYS;
export const IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID = 'rsa-oaep-mgf1p';
export const IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID = 'aes256-cbc';

export interface IdpEncryptionKeyTransportOption {
	id: string;
	xmlKeyTransportAlgorithm: string;
	keyFamily: 'rsa';
	labelKey: string;
	deprecated?: boolean;
}

export const IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS: readonly IdpEncryptionKeyTransportOption[] = [
	{
		id: 'rsa-oaep-mgf1p',
		xmlKeyTransportAlgorithm: 'http://www.w3.org/2009/xmlenc11#rsa-oaep-mgf1p',
		keyFamily: 'rsa',
		labelKey: 'rsa-oaep-mgf1p',
	},
	{
		id: 'rsa-oaep',
		xmlKeyTransportAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-oaep',
		keyFamily: 'rsa',
		labelKey: 'rsa-oaep',
	},
	{
		id: 'rsa-1_5',
		xmlKeyTransportAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-1_5',
		keyFamily: 'rsa',
		labelKey: 'rsa-1_5',
		deprecated: true,
	},
] as const;

export interface IdpContentEncryptionAlgorithmOption {
	id: string;
	xmlEncryptionMethod: string;
	labelKey: string;
}

export const IDP_CONTENT_ENCRYPTION_ALGORITHMS: readonly IdpContentEncryptionAlgorithmOption[] = [
	{
		id: 'aes256-cbc',
		xmlEncryptionMethod: 'http://www.w3.org/2001/04/xmlenc#aes256-cbc',
		labelKey: 'aes256-cbc',
	},
	{
		id: 'aes128-cbc',
		xmlEncryptionMethod: 'http://www.w3.org/2001/04/xmlenc#aes128-cbc',
		labelKey: 'aes128-cbc',
	},
] as const;

export interface StoredEncryptionCrypto {
	encryptionKeyFamily: IdpCertKeyFamily;
	encryptionKeyTransportAlgorithmId: string | null;
	encryptionRsaModulusBits: number | null;
	encryptionEcCurve: IdpCertEcCurve | null;
}

export interface GenerateIdpEncryptionCertRequestDto {
	keyFamily?: IdpCertKeyFamily;
	rsaModulusBits?: IdpCertRsaModulusBits;
	ecCurve?: IdpCertEcCurve;
	keyTransportAlgorithmId?: string;
	notAfter?: string;
}

export class IdpEncryptionCryptoValidationError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = 'IdpEncryptionCryptoValidationError';
	}
}

export function getIdpEncryptionKeyTransportOption(
	id: string,
): IdpEncryptionKeyTransportOption | undefined {
	return IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS.find((entry) => entry.id === id);
}

export function getIdpContentEncryptionOption(
	id: string,
): IdpContentEncryptionAlgorithmOption | undefined {
	return IDP_CONTENT_ENCRYPTION_ALGORITHMS.find((entry) => entry.id === id);
}

export function listKeyTransportOptionsForKeyFamily(
	keyFamily: IdpCertKeyFamily,
): IdpEncryptionKeyTransportOption[] {
	if (keyFamily === 'ec') {
		return [];
	}
	return [...IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS];
}

export function assertCompatibleKeyAndKeyTransport(
	keyFamily: IdpCertKeyFamily,
	transportId: string | null,
): IdpEncryptionKeyTransportOption | null {
	if (keyFamily === 'ec') {
		if (transportId !== null) {
			throw new IdpEncryptionCryptoValidationError(
				'keyTransportAlgorithmId must not be set for EC encryption keys',
				'idp_encryption_transport_with_ec',
			);
		}
		return null;
	}
	if (transportId === null) {
		throw new IdpEncryptionCryptoValidationError(
			'keyTransportAlgorithmId is required for RSA encryption keys',
			'idp_encryption_missing_transport',
		);
	}
	const option = getIdpEncryptionKeyTransportOption(transportId);
	if (!option) {
		throw new IdpEncryptionCryptoValidationError(
			`Unknown keyTransportAlgorithmId: ${transportId}`,
			'idp_encryption_unknown_transport',
		);
	}
	return option;
}

export function resolveGenerateIdpEncryptionCertRequest(
	input: GenerateIdpEncryptionCertRequestDto = {},
	now = new Date(),
): {
	keyFamily: IdpCertKeyFamily;
	rsaModulusBits: IdpCertRsaModulusBits;
	ecCurve: IdpCertEcCurve;
	keyTransportAlgorithmId: string | null;
	notAfter: string;
} {
	const keyFamily: IdpCertKeyFamily = input.keyFamily ?? 'rsa';
	let rsaModulusBits: IdpCertRsaModulusBits = DEFAULT_IDP_RSA_MODULUS_BITS;
	let ecCurve: IdpCertEcCurve = 'P-256';
	let keyTransportAlgorithmId: string | null = IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID;

	if (keyFamily === 'rsa') {
		rsaModulusBits = input.rsaModulusBits ?? DEFAULT_IDP_RSA_MODULUS_BITS;
		if (!(IDP_CERT_RSA_MODULUS_BITS as readonly number[]).includes(rsaModulusBits)) {
			throw new IdpEncryptionCryptoValidationError(
				'rsaModulusBits must be 2048, 3072, or 4096',
				'idp_encryption_bad_rsa_modulus',
			);
		}
		if (input.ecCurve !== undefined) {
			throw new IdpEncryptionCryptoValidationError(
				'ecCurve must not be set when keyFamily is rsa',
				'idp_encryption_ec_curve_with_rsa',
			);
		}
		const transportId =
			input.keyTransportAlgorithmId ?? IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID;
		assertCompatibleKeyAndKeyTransport('rsa', transportId);
		keyTransportAlgorithmId = transportId;
	} else {
		ecCurve = input.ecCurve ?? 'P-256';
		if (!(IDP_CERT_EC_CURVES as readonly string[]).includes(ecCurve)) {
			throw new IdpEncryptionCryptoValidationError(
				'ecCurve must be P-256, P-384, or P-521',
				'idp_encryption_bad_curve',
			);
		}
		if (input.rsaModulusBits !== undefined) {
			throw new IdpEncryptionCryptoValidationError(
				'rsaModulusBits must not be set when keyFamily is ec',
				'idp_encryption_rsa_bits_with_ec',
			);
		}
		if (input.keyTransportAlgorithmId !== undefined) {
			throw new IdpEncryptionCryptoValidationError(
				'keyTransportAlgorithmId must not be set for EC encryption keys',
				'idp_encryption_transport_with_ec',
			);
		}
		keyTransportAlgorithmId = null;
	}

	let notAfter: string;
	try {
		notAfter = validateIdpCertNotAfter(input.notAfter ?? defaultNotAfterCalendarDate(now), now);
	} catch (error) {
		if (error instanceof IdpCertCommonValidationError) {
			throw new IdpEncryptionCryptoValidationError(error.message, error.code);
		}
		throw error;
	}

	return {
		keyFamily,
		rsaModulusBits,
		ecCurve,
		keyTransportAlgorithmId,
		notAfter,
	};
}

export function toStoredEncryptionCrypto(
	resolved: ReturnType<typeof resolveGenerateIdpEncryptionCertRequest>,
): StoredEncryptionCrypto {
	return {
		encryptionKeyFamily: resolved.keyFamily,
		encryptionKeyTransportAlgorithmId: resolved.keyTransportAlgorithmId,
		encryptionRsaModulusBits: resolved.keyFamily === 'rsa' ? resolved.rsaModulusBits : null,
		encryptionEcCurve: resolved.keyFamily === 'ec' ? resolved.ecCurve : null,
	};
}

export function getDefaultGenerateIdpEncryptionCertRequest(
	now = new Date(),
): GenerateIdpEncryptionCertRequestDto {
	return {
		keyFamily: 'rsa',
		rsaModulusBits: DEFAULT_IDP_RSA_MODULUS_BITS,
		keyTransportAlgorithmId: IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
		notAfter: defaultNotAfterCalendarDate(now),
	};
}

export interface IdpEcKeyAgreementOption {
	id: string;
	xmlAgreementMethod: string;
	keyFamily: 'ec';
	labelKey: string;
}

export const IDP_EC_KEY_AGREEMENT_ALGORITHMS: readonly IdpEcKeyAgreementOption[] = [
	{
		id: 'ecdh-es',
		xmlAgreementMethod: 'http://www.w3.org/2009/xmlenc11#ECDH-ES',
		keyFamily: 'ec',
		labelKey: 'ecdh-es',
	},
] as const;

export const IDP_ENCRYPTION_DEFAULT_EC_KEY_AGREEMENT_ALGORITHM_ID = 'ecdh-es';

export function getIdpEcKeyAgreementOption(id: string): IdpEcKeyAgreementOption | undefined {
	return IDP_EC_KEY_AGREEMENT_ALGORITHMS.find((e) => e.id === id);
}

export function listKeyAgreementOptionsForKeyFamily(
	keyFamily: IdpCertKeyFamily,
): IdpEcKeyAgreementOption[] {
	if (keyFamily !== 'ec') return [];
	return [...IDP_EC_KEY_AGREEMENT_ALGORITHMS];
}

export function buildIdpEncryptionGenerateOptionsForUi(now = new Date()) {
	return {
		keyFamilies: ['rsa', 'ec'] as const,
		rsaModulusBits: IDP_CERT_RSA_MODULUS_BITS,
		ecCurves: IDP_CERT_EC_CURVES,
		algorithms: IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS,
		defaultRequest: getDefaultGenerateIdpEncryptionCertRequest(now),
		maxValidityYears: IDP_ENCRYPTION_CERT_MAX_VALIDITY_YEARS,
		defaultValidityDays: IDP_ENCRYPTION_CERT_DEFAULT_VALIDITY_DAYS,
	};
}
