/**
 * Centralised input-size limits for cryptographic / SAML payloads (Prompt 38 §A20). These caps were
 * hand-duplicated as local `const`s (and bare `@MaxLength(...)` literals in DTOs) across the cert utils,
 * the SP-connection DTOs and the SAML request parsers; this is the single source of truth.
 */

/** Maximum accepted length of an operator-supplied PEM (certificate or private key), in characters. */
export const MAX_PEM_LENGTH = 16_384;

/** Maximum accepted size of an inbound SAML protocol message (request/response), in bytes. */
export const MAX_SAML_REQUEST_BYTES = 256 * 1024;
