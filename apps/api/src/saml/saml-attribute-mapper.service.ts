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
		if (source === 'username') {
			return user.username;
		}
		if (source === 'email' && user.email) {
			return user.email;
		}
		const emailFormat = defaultFormat.includes('email');
		if (emailFormat && user.email) {
			return user.email;
		}
		return user.username;
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
