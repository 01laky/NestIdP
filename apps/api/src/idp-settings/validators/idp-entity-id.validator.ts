import { SAML_NAME_ID_FORMATS } from '@nestidp/shared';

export class IdpEntityIdValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IdpEntityIdValidationError';
	}
}

export class IdpNameIdFormatValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IdpNameIdFormatValidationError';
	}
}

export function assertValidIdpEntityId(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new IdpEntityIdValidationError('entityId is required');
	}
	if (trimmed.length > 512) {
		throw new IdpEntityIdValidationError('entityId is too long');
	}
	if (
		!trimmed.startsWith('http://') &&
		!trimmed.startsWith('https://') &&
		!trimmed.startsWith('urn:')
	) {
		throw new IdpEntityIdValidationError('entityId must be an http(s) URL or urn');
	}
	return trimmed;
}

export function assertValidIdpNameIdFormat(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new IdpNameIdFormatValidationError('nameIdFormat is required');
	}
	if ((SAML_NAME_ID_FORMATS as readonly string[]).includes(trimmed)) {
		return trimmed;
	}
	if (trimmed.startsWith('urn:') && trimmed.length <= 512) {
		return trimmed;
	}
	throw new IdpNameIdFormatValidationError('Invalid nameIdFormat');
}
