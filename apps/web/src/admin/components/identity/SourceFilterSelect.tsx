import { useTranslation } from 'react-i18next';
import type { IdentitySourceOptionDto } from '@nestidp/shared';
import { Select } from '../../../ui';

/**
 * The sync-source filter dropdown shared by the identity user/group/role list pages (Prompt 38 §A15 / §6.9).
 * Pairs with {@link useIdentitySources} — the page owns the selected value, this renders the `<Select>` and
 * its options. Extracted from the identical `<Select label={t('sourceFilter')}>` JSX copy-pasted per page.
 */
export function SourceFilterSelect({
	sources,
	value,
	onChange,
	disabled,
}: {
	sources: IdentitySourceOptionDto[];
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslation('identity');
	return (
		<Select
			label={t('sourceFilter')}
			fieldClassName="evg-field--fixed"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			disabled={disabled}
		>
			<option value="">{t('sourceAll')}</option>
			{sources.map((s) => (
				<option key={s.apiConnectionId} value={s.apiConnectionId}>
					{s.label}
				</option>
			))}
		</Select>
	);
}
