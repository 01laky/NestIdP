import type { ReactNode } from 'react';
import type { IdentityGroupMemberDto } from '@nestidp/shared';
import type { TFunction } from 'i18next';

const MEMBER_PREVIEW_MAX = 5;

export function buildIdentityMemberDeleteDetail(
	members: IdentityGroupMemberDto[],
	memberCount: number,
	t: TFunction<'identity'>,
): ReactNode | undefined {
	if (memberCount <= 0) {
		return undefined;
	}
	const preview = members.slice(0, MEMBER_PREVIEW_MAX);
	const remaining = memberCount - preview.length;
	return (
		<ul className="evg-list">
			{preview.map((member) => (
				<li key={member.id}>{member.username}</li>
			))}
			{remaining > 0 ? <li>{t('andNMoreMembers', { count: remaining })}</li> : null}
		</ul>
	);
}
