import { EC_CURVE_OPTIONS, RSA_MODULUS_BITS_OPTIONS } from './constants';

export type RsaModulusBitsOption = (typeof RSA_MODULUS_BITS_OPTIONS)[number];

export type EcCurveOption = (typeof EC_CURVE_OPTIONS)[number];
