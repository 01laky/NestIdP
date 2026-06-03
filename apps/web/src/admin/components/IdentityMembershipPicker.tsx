import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IdentityOriginLiteral } from '@nestidp/shared';
import { AdminApiError, listIdentityGroups, listIdentityRoles } from '../adminApi';
import { identityOriginLabel } from '../status-badge';
import { Checkbox, ErrorBanner, Fieldset, TextInput } from '../../ui';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';

const MAX_SELECTED = 100;
const LIST_LIMIT = 200;

type MembershipKind = 'groups' | 'roles';

interface IdentityMembershipPickerProps {
	groupIds: string[];
	roleIds: string[];
	onGroupIdsChange: (ids: string[]) => void;
	onRoleIdsChange: (ids: string[]) => void;
	disabled?: boolean;
}

export function IdentityMembershipPicker({
	groupIds,
	roleIds,
	onGroupIdsChange,
	onRoleIdsChange,
	disabled = false,
}: IdentityMembershipPickerProps) {
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const [loadError, setLoadError] = useState<string | null>(null);
	const [groups, setGroups] = useState<
		Array<{ id: string; name: string; origin: IdentityOriginLiteral }>
	>([]);
	const [roles, setRoles] = useState<
		Array<{ id: string; name: string; origin: IdentityOriginLiteral }>
	>([]);
	const [groupFilter, setGroupFilter] = useState('');
	const [roleFilter, setRoleFilter] = useState('');

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const [groupData, roleData] = await Promise.all([
					listIdentityGroups({ limit: LIST_LIMIT }),
					listIdentityRoles({ limit: LIST_LIMIT }),
				]);
				if (!cancelled) {
					setGroups(
						groupData.items.map((g) => ({
							id: g.id,
							name: g.name,
							origin: g.origin,
						})),
					);
					setRoles(
						roleData.items.map((r) => ({
							id: r.id,
							name: r.name,
							origin: r.origin,
						})),
					);
				}
			} catch (err) {
				if (!cancelled) {
					setLoadError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'identity.loadMembershipFailed',
								)
							: t('loadMembershipFailed'),
					);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [t]);

	const filteredGroups = useMemo(() => {
		const q = groupFilter.trim().toLowerCase();
		if (!q) {
			return groups;
		}
		return groups.filter((g) => g.name.toLowerCase().includes(q));
	}, [groups, groupFilter]);

	const filteredRoles = useMemo(() => {
		const q = roleFilter.trim().toLowerCase();
		if (!q) {
			return roles;
		}
		return roles.filter((r) => r.name.toLowerCase().includes(q));
	}, [roles, roleFilter]);

	function toggleId(id: string, selected: string[], onChange: (ids: string[]) => void) {
		if (selected.includes(id)) {
			onChange(selected.filter((x) => x !== id));
			return;
		}
		if (selected.length >= MAX_SELECTED) {
			return;
		}
		onChange([...selected, id]);
	}

	function renderFieldset(
		kind: MembershipKind,
		legend: string,
		items: Array<{ id: string; name: string; origin: IdentityOriginLiteral }>,
		filter: string,
		onFilterChange: (value: string) => void,
		selected: string[],
		onChange: (ids: string[]) => void,
	) {
		const atCap = selected.length >= MAX_SELECTED;
		return (
			<Fieldset legend={legend} disabled={disabled}>
				<TextInput
					label={t('filterByName')}
					labelVisuallyHidden
					placeholder={t('filterByNamePlaceholder')}
					value={filter}
					onChange={(e) => onFilterChange(e.target.value)}
				/>
				{atCap ? (
					<p className="evg-muted">{t('maxSelected', { max: MAX_SELECTED, kind })}</p>
				) : null}
				{items.length === 0 ? (
					<p className="evg-muted">{t('noMatches')}</p>
				) : (
					<ul className="evg-stack">
						{items.map((item) => {
							const checked = selected.includes(item.id);
							const checkboxDisabled = disabled || (!checked && atCap);
							return (
								<li key={item.id}>
									<Checkbox
										label={`${item.name} (${identityOriginLabel(item.origin)})`}
										checked={checked}
										disabled={checkboxDisabled}
										onChange={() => toggleId(item.id, selected, onChange)}
									/>
								</li>
							);
						})}
					</ul>
				)}
			</Fieldset>
		);
	}

	return (
		<>
			{loadError ? <ErrorBanner message={loadError} /> : null}
			{renderFieldset(
				'groups',
				tNav('groups'),
				filteredGroups,
				groupFilter,
				setGroupFilter,
				groupIds,
				onGroupIdsChange,
			)}
			{renderFieldset(
				'roles',
				tNav('roles'),
				filteredRoles,
				roleFilter,
				setRoleFilter,
				roleIds,
				onRoleIdsChange,
			)}
		</>
	);
}
