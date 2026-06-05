/** Default certificate validity window when the operator has not picked a date (≈2 years). */
export const DEFAULT_CERT_NOT_AFTER_DAYS = 730;

export const RSA_MODULUS_BITS_OPTIONS = [2048, 3072, 4096] as const;

export const EC_CURVE_OPTIONS = ['P-256', 'P-384', 'P-521'] as const;
