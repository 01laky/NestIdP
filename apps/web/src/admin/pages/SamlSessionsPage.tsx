import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	SAML_SESSIONS_LIST_PAGE_SIZE,
	type SamlSsoSessionListResponseDto,
	type SamlSsoSessionPublicDto,
	type SamlSsoSessionStatusFilter,
} from '@nestidp/shared';
import {
	AdminApiError,
	listSamlSessions,
	listSpConnections,
	terminateSamlSession,
	terminateSamlSessionsByUser,
} from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import {
	Badge,
	Button,
	Callout,
	EmptyState,
	Select,
	Table,
	TextInput,
	useConfirm,
	useToast,
} from '../../ui';

interface SpOption {
	id: string;
	name: string;
}

export function SamlSessionsPage() {
	const { t } = useTranslation('samlSessions');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('title'));
	const confirm = useConfirm();
	const { showToast } = useToast();

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<SamlSsoSessionStatusFilter>('active');
	const [spConnectionId, setSpConnectionId] = useState('');
	const [q, setQ] = useState('');
	const [page, setPage] = useState(1);
	const [data, setData] = useState<SamlSsoSessionListResponseDto | null>(null);
	const [spOptions, setSpOptions] = useState<SpOption[]>([]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await listSamlSessions({
				status,
				spConnectionId: spConnectionId || undefined,
				q: q.trim() || undefined,
				page,
				pageSize: SAML_SESSIONS_LIST_PAGE_SIZE,
			});
			setData(result);
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(
							err.statusCode,
							err.message,
							resolveI18nKey,
							'samlSessions.loadFailed',
						)
					: t('loadFailed'),
			);
		} finally {
			setLoading(false);
		}
	}, [status, spConnectionId, q, page, t]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		void listSpConnections()
			.then((res) => setSpOptions(res.items.map((s) => ({ id: s.id, name: s.name }))))
			.catch(() => setSpOptions([]));
	}, []);

	async function onTerminate(session: SamlSsoSessionPublicDto) {
		const ok = await confirm({
			title: t('confirmTerminateTitle'),
			description: t('confirmTerminateDescription', { username: session.username }),
			confirmLabel: t('terminate'),
			tone: 'danger',
			showAuditNote: true,
		});
		if (!ok) {
			return;
		}
		try {
			await terminateSamlSession(session.id);
			showToast(t('toastTerminated'));
			await load();
		} catch (err) {
			showToast(err instanceof AdminApiError ? err.message : t('terminateFailed'));
		}
	}

	async function onTerminateAllForUser(session: SamlSsoSessionPublicDto) {
		if (!session.userId) {
			return;
		}
		const ok = await confirm({
			title: t('confirmTerminateUserTitle'),
			description: t('confirmTerminateUserDescription', { username: session.username }),
			confirmLabel: t('terminateAllForUser'),
			tone: 'danger',
			showAuditNote: true,
		});
		if (!ok) {
			return;
		}
		try {
			const res = await terminateSamlSessionsByUser(session.userId);
			showToast(t('toastTerminatedUser', { count: res.terminatedCount }));
			await load();
		} catch (err) {
			showToast(err instanceof AdminApiError ? err.message : t('terminateFailed'));
		}
	}

	const total = data?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / SAML_SESSIONS_LIST_PAGE_SIZE));

	return (
		<section>
			<AdminPageHeader
				title={t('title')}
				subtitle={t('subtitle')}
				breadcrumbs={[{ label: tNav('dashboard'), to: '/admin' }, { label: t('title') }]}
			/>
			<Callout variant="info">{t('limitationNote')}</Callout>
			<details className="evg-filters-panel evg-filters-panel--collapsible">
				<summary>{t('filters')}</summary>
				<form
					className="evg-stack inline"
					onSubmit={(e) => {
						e.preventDefault();
						setPage(1);
						void load();
					}}
				>
					<Select
						label={t('statusFilter')}
						value={status}
						onChange={(e) => {
							setStatus(e.target.value as SamlSsoSessionStatusFilter);
							setPage(1);
						}}
					>
						<option value="active">{t('statusActive')}</option>
						<option value="terminated">{t('statusTerminated')}</option>
						<option value="all">{tCommon('all')}</option>
					</Select>
					<Select
						label={t('spFilter')}
						value={spConnectionId}
						onChange={(e) => {
							setSpConnectionId(e.target.value);
							setPage(1);
						}}
					>
						<option value="">{tCommon('all')}</option>
						{spOptions.map((sp) => (
							<option key={sp.id} value={sp.id}>
								{sp.name}
							</option>
						))}
					</Select>
					<TextInput
						label={t('search')}
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder={t('searchPlaceholder')}
					/>
					<Button type="submit" variant="primary">
						{tCommon('filter')}
					</Button>
				</form>
			</details>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{data && !loading ? (
				data.items.length === 0 ? (
					<EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
				) : (
					<>
						<p className="evg-muted">{t('showing', { shown: data.items.length, total })}</p>
						<div className="evg-table-wrap">
							<Table>
								<thead>
									<tr>
										<th>{t('colUser')}</th>
										<th>{t('colServiceProviders')}</th>
										<th>{t('colLoginIp')}</th>
										<th>{t('colUserAgent')}</th>
										<th>{t('colLastActive')}</th>
										<th>{tCommon('status')}</th>
										<th>{tCommon('actions')}</th>
									</tr>
								</thead>
								<tbody>
									{data.items.map((session) => (
										<tr key={session.id}>
											<td>{session.username}</td>
											<td>
												{session.participations.length === 0
													? tCommon('emDash')
													: session.participations.map((p) => p.spName).join(', ')}
											</td>
											<td className="evg-muted">{session.loginIp ?? tCommon('emDash')}</td>
											<td className="evg-muted" title={session.userAgent ?? undefined}>
												{session.userAgent ? truncate(session.userAgent, 40) : tCommon('emDash')}
											</td>
											<td className="evg-muted">{new Date(session.lastSeenAt).toLocaleString()}</td>
											<td>
												<Badge variant={session.status === 'active' ? 'success' : 'neutral'}>
													{session.status === 'active' ? t('statusActive') : t('statusTerminated')}
												</Badge>
											</td>
											<td>
												{session.status === 'active' ? (
													<div className="evg-stack inline">
														<Button
															type="button"
															variant="link"
															onClick={() => void onTerminate(session)}
														>
															{t('terminate')}
														</Button>
														{session.userId ? (
															<Button
																type="button"
																variant="link"
																onClick={() => void onTerminateAllForUser(session)}
															>
																{t('terminateAllForUser')}
															</Button>
														) : null}
													</div>
												) : (
													tCommon('emDash')
												)}
											</td>
										</tr>
									))}
								</tbody>
							</Table>
						</div>
						<div className="evg-stack inline">
							<Button
								type="button"
								variant="ghost"
								disabled={page <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
							>
								{tCommon('previous')}
							</Button>
							<span className="evg-muted">{t('pageOf', { page, totalPages })}</span>
							<Button
								type="button"
								variant="ghost"
								disabled={page >= totalPages}
								onClick={() => setPage((p) => p + 1)}
							>
								{tCommon('next')}
							</Button>
						</div>
					</>
				)
			) : null}
		</section>
	);
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max)}…` : value;
}
