import type { SpAttributeMappingConfig } from '@nestidp/shared';

const ALLOWED_SOURCES = new Set(['email', 'displayName', 'username', 'groups', 'roles']);
const ALLOWED_NAME_ID_SOURCES = new Set(['email', 'username']);

export class SpAttributeMappingValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SpAttributeMappingValidationError';
	}
}

export function assertValidSpAttributeMapping(
	value: SpAttributeMappingConfig | null | undefined,
): SpAttributeMappingConfig | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new SpAttributeMappingValidationError('attributeMapping must be an object');
	}

	if (value.nameId !== undefined) {
		if (typeof value.nameId !== 'object' || value.nameId === null) {
			throw new SpAttributeMappingValidationError('nameId must be an object');
		}
		if (!ALLOWED_NAME_ID_SOURCES.has(value.nameId.source)) {
			throw new SpAttributeMappingValidationError('Invalid nameId source');
		}
		if (value.nameId.format !== undefined && typeof value.nameId.format !== 'string') {
			throw new SpAttributeMappingValidationError('nameId format must be a string');
		}
	}

	if (value.attributes !== undefined) {
		if (!Array.isArray(value.attributes)) {
			throw new SpAttributeMappingValidationError('attributes must be an array');
		}
		for (const entry of value.attributes) {
			if (!entry || typeof entry !== 'object') {
				throw new SpAttributeMappingValidationError('Invalid attribute entry');
			}
			if (typeof entry.samlName !== 'string' || entry.samlName.trim().length === 0) {
				throw new SpAttributeMappingValidationError('samlName is required');
			}
			if (!ALLOWED_SOURCES.has(entry.source)) {
				throw new SpAttributeMappingValidationError(`Invalid attribute source: ${entry.source}`);
			}
		}
	}

	return value;
}
