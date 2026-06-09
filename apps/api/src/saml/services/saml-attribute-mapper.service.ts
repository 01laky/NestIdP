import { Injectable } from '@nestjs/common';
import type { EndUserPublicDto, SpAttributeMappingConfig } from '@nestidp/shared';

export interface MappedSamlAttributes {
	nameId: string;
	nameIdFormat: string;
	attributes: Array<{ name: string; values: string[] }>;
}

@Injectable()
export class SamlAttributeMapperService {
	mapUser(
		user: EndUserPublicDto,
		nameIdFormat: string,
		mapping: SpAttributeMappingConfig | null,
	): MappedSamlAttributes {
		const nameId = this.resolveNameId(user, nameIdFormat, mapping);
		const attributes: Array<{ name: string; values: string[] }> = [];

		if (mapping?.attributes?.length) {
			for (const entry of mapping.attributes) {
				const values = this.resolveSource(user, entry.source);
				if (values.length > 0) {
					attributes.push({ name: entry.samlName, values });
				}
			}
		} else {
			if (user.email) {
				attributes.push({ name: 'email', values: [user.email] });
			}
			if (user.displayName) {
				attributes.push({ name: 'displayName', values: [user.displayName] });
			}
			if (user.groups.length > 0) {
				attributes.push({ name: 'memberOf', values: [...user.groups] });
			}
			if (user.roles.length > 0) {
				attributes.push({ name: 'role', values: [...user.roles] });
			}
		}

		return {
			nameId,
			nameIdFormat: mapping?.nameId?.format ?? nameIdFormat,
			attributes,
		};
	}

	private resolveNameId(
		user: EndUserPublicDto,
		defaultFormat: string,
		mapping: SpAttributeMappingConfig | null,
	): string {
		const source = mapping?.nameId?.source;
		let nameId: string;
		if (source === 'username') {
			nameId = user.username;
		} else if (source === 'email' && user.email) {
			nameId = user.email;
		} else if (defaultFormat.includes('email') && user.email) {
			nameId = user.email;
		} else {
			nameId = user.username;
		}
		// §5.B12: never emit an empty NameID. `<saml2:NameID/>` is rejected by SPs; surfacing this as a
		// clear error beats issuing a malformed assertion (e.g. an email-format SP mapped to a user with
		// no email AND no username).
		if (!nameId || nameId.trim().length === 0) {
			throw new Error(
				'Resolved SAML NameID is empty — user has no usable username/email for this SP',
			);
		}
		return nameId;
	}

	private resolveSource(user: EndUserPublicDto, source: string): string[] {
		switch (source) {
			case 'email':
				return user.email ? [user.email] : [];
			case 'displayName':
				return user.displayName ? [user.displayName] : [];
			case 'username':
				return [user.username];
			case 'groups':
				return [...user.groups];
			case 'roles':
				return [...user.roles];
			default:
				return [];
		}
	}
}
