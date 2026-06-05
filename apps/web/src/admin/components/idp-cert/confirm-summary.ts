import type {
	GenerateIdpEncryptionCertRequestDto,
	GenerateIdpSigningCertRequestDto,
} from '@nestidp/shared';

export function buildCertOptionsConfirmSummary(
	value: GenerateIdpSigningCertRequestDto,
	t: (key: string, opts?: Record<string, string>) => string,
): string {
	const family = value.keyFamily ?? 'rsa';
	const detail =
		family === 'rsa' ? `${value.rsaModulusBits ?? 2048} bit` : (value.ecCurve ?? 'P-256');
	const algo = value.signatureAlgorithmId ?? (family === 'ec' ? 'ecdsa-sha256' : 'rsa-sha256');
	return t('confirmGenerateSummary', {
		family,
		detail,
		algorithm: algo,
		notAfter: value.notAfter ?? '',
	});
}

export function buildEncryptionCertOptionsConfirmSummary(
	value: GenerateIdpEncryptionCertRequestDto,
	t: (key: string, opts?: Record<string, string>) => string,
): string {
	const family = value.keyFamily ?? 'rsa';
	const detail =
		family === 'rsa' ? `${value.rsaModulusBits ?? 2048} bit` : (value.ecCurve ?? 'P-256');
	const algo =
		family === 'rsa'
			? (value.keyTransportAlgorithmId ?? 'rsa-oaep-mgf1p')
			: t('encryption.crypto.ecNoKeyTransport');
	return t('encryption.confirmGenerateSummary', {
		family,
		detail,
		algorithm: algo,
		notAfter: value.notAfter ?? '',
	});
}
