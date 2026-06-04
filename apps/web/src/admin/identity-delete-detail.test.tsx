import { cleanup, render, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { initI18nForTests } from '../i18n/I18nProvider';
import { getI18n } from '../i18n/i18n';
import { buildIdentityMemberDeleteDetail } from './identity-delete-detail';

await initI18nForTests('en');

afterEach(() => {
	cleanup();
});

function renderDetail(memberCount: number, memberIds: string[]) {
	const members = memberIds.map((id, i) => ({
		id,
		username: `user-${i + 1}`,
		origin: 'manual' as const,
	}));
	const node = buildIdentityMemberDeleteDetail(
		members,
		memberCount,
		getI18n().getFixedT('en', 'identity'),
	);
	if (!node) {
		return null;
	}
	const view = render(<I18nextProvider i18n={getI18n()}>{node}</I18nextProvider>);
	return within(view.container);
}

describe('buildIdentityMemberDeleteDetail', () => {
	it('WEB-ADM-CONF-25: memberCount 0 returns undefined', () => {
		expect(
			buildIdentityMemberDeleteDetail([], 0, getI18n().getFixedT('en', 'identity')),
		).toBeUndefined();
	});

	it('WEB-ADM-CONF-26: lists up to 5 usernames without overflow line', () => {
		const scope = renderDetail(3, ['u1', 'u2', 'u3'])!;
		expect(scope.getByText('user-1')).toBeDefined();
		expect(scope.getByText('user-3')).toBeDefined();
		expect(scope.queryByText(/more/i)).toBeNull();
	});

	it('WEB-ADM-CONF-27: more than 5 members shows andNMoreMembers for remainder', () => {
		const scope = renderDetail(8, ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'])!;
		expect(scope.getByText('user-1')).toBeDefined();
		expect(scope.getByText('user-5')).toBeDefined();
		expect(scope.queryByText('user-6')).toBeNull();
		expect(scope.getByText(/3 more/i)).toBeDefined();
	});

	it('WEB-ADM-CONF-28: memberCount exceeds returned members still shows overflow count', () => {
		const scope = renderDetail(10, ['u1', 'u2', 'u3'])!;
		expect(scope.getByText(/7 more/i)).toBeDefined();
	});
});
