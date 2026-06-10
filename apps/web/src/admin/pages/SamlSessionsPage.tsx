import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	SAML_SESSIONS_LIST_PAGE_SIZE,
	type BackchannelLogoutStatus,
	type SamlBackchannelLogoutPublicDto,
	type SamlBackchannelQueueHealthDto,
	type SamlSsoSessionListResponseDto,
	type SamlSsoSessionPublicDto,
	type SamlSsoSessionStatusFilter,
} from '@nestidp/shared';
import {
	AdminApiError,
	getBackchannelQueueHealth,
	listSamlSessions,
	listSpConnections,
	processBackchannelQueue,
	resendBackchannelLogout,
	terminateAllSamlSessions,
	terminateSamlSession,
	terminateSamlSessionsBulk,
	terminateSamlSessionsByUser,
} from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { useIdentitySources } from '../hooks/useIdentitySources';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { mapAdminError } from '../../i18n/api-error-messages';
import {
	Badge,
	Button,
	Callout,
	Checkbox,
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

const BC_BADGE_VARIANT: Record<BackchannelLogoutStatus, 'success' | 'neutral' | 'danger'> = {
	pending: 'neutral',
	in_flight: 'neutral',
	succeeded: 'success',
	partial: 'success',
	failed: 'danger',
	given_up: 'danger',
	skipped_no_endpoint: 'neutral',
};

const BC_STATUS_KEY: Record<BackchannelLogoutStatus, string> = {
	pending: 'bcStatusPending',
	in_flight: 'bcStatusInFlight',
	succeeded: 'bcStatusSucceeded',
	partial: 'bcStatusPartial',
	failed: 'bcStatusFailed',
	given_up: 'bcStatusGivenUp',
	skipped_no_endpoint: 'bcStatusSkipped',
};

export function SamlSessionsPage() {
	const { t } = useTranslation('samlSessions');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const { t: tIdentity } = useTranslation('identity');
	useAdminDocumentTitle(t('title'));
	const confirm = useConfirm();
	const { showToast } = useToast();

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<SamlSsoSessionStatusFilter>('active');
	const [spConnectionId, setSpConnectionId] = useState('');
	const [apiConnectionId, setApiConnectionId] = useState('');
	const { sources } = useIdentitySources();
	const [q, setQ] = useState('');
	const [page, setPage] = useState(1);
	const [data, setData] = useState<SamlSsoSessionListResponseDto | null>(null);
	const [spOptions, setSpOptions] = useState<SpOption[]>([]);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkBusy, setBulkBusy] = useState(false);
	const [queueHealth, setQueueHealth] = useState<SamlBackchannelQueueHealthDto | null>(null);

	const loadQueueHealth = useCallback(async () => {
		try {
			setQueueHealth(await getBackchannelQueueHealth());
		} catch {
			setQueueHealth(null);
		}
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await listSamlSessions({
				status,
				spConnectionId: spConnectionId || undefined,
				apiConnectionId: apiConnectionId || undefined,
				q: q.trim() || undefined,
				page,
				pageSize: SAML_SESSIONS_LIST_PAGE_SIZE,
			});
			setData(result);
			setSelectedIds(new Set());
		} catch (err) {
			setError(mapAdminError(err, 'samlSessions.loadFailed'));
		} finally {
			setLoading(false);
		}
	}, [status, spConnectionId, apiConnectionId, q, page]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		void loadQueueHealth();
	}, [loadQueueHealth]);

	useEffect(() => {
		void listSpConnections()
			.then((res) => setSpOptions(res.items.map((s) => ({ id: s.id, name: s.name }))))
			.catch(() => setSpOptions([]));
	}, []);

	const activeIds = useMemo(
		() => (data?.items ?? []).filter((s) => s.status === 'active').map((s) => s.id),
		[data],
	);
	const allActiveSelected = activeIds.length > 0 && activeIds.every((id) => selectedIds.has(id));

	function toggleRow(id: string, checked: boolean) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (checked) {
				next.add(id);
			} else {
				next.delete(id);
			}
			return next;
		});
	}

	function toggleSelectAll(checked: boolean) {
		setSelectedIds(checked ? new Set(activeIds) : new Set());
	}

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
			await Promise.all([load(), loadQueueHealth()]);
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
			await Promise.all([load(), loadQueueHealth()]);
		} catch (err) {
			showToast(err instanceof AdminApiError ? err.message : t('terminateFailed'));
		}
	}

	async function onTerminateSelected() {
		const ids = [...selectedIds];
		if (ids.length === 0) {
			return;
		}
		const ok = await confirm({
			title: t('confirmBulkTitle'),
			description: t('confirmBulkDescription', { count: ids.length }),
			confirmLabel: t('terminateSelected'),
			tone: 'danger',
			showAuditNote: true,
		});
		if (!ok) {
			return;
		}
		setBulkBusy(true);
		try {
			const res = await terminateSamlSessionsBulk(ids);
			showToast(t('toastBulkTerminated', { count: res.terminatedCount }));
			await Promise.all([load(), loadQueueHealth()]);
		} catch (err) {
			showToast(err instanceof AdminApiError ? err.message : t('terminateFailed'));
		} finally {
			setBulkBusy(false);
		}
	}

	async function onTerminateAll() {
		const ok = await confirm({
			title: t('confirmAllTitle'),
			description: t('confirmAllDescription'),
			confirmLabel: t('terminateAllActive'),
			tone: 'danger',
			showAuditNote: true,
		});
		if (!ok) {
			return;
		}
		setBulkBusy(true);
		try {
			const res = await terminateAllSamlSessions();
			showToast(t('toastAllTerminated', { count: res.terminatedCount }));
			await Promise.all([load(), loadQueueHealth()]);
		} catch (err) {
			showToast(err instanceof AdminApiError ? err.message : t('terminateFailed'));
		} finally {
			setBulkBusy(false);
		}
	}

	async function onProcessQueue() {
		setBulkBusy(true);
		try {
			const res = await processBackchannelQueue();
			showToast(t('toastQueueProcessed', { count: res.processed }));
			await Promise.all([load(), loadQueueHealth()]);
		} catch (err) {
			showToast(err instanceof AdminApiError ? err.message : t('terminateFailed'));
		} finally {
			setBulkBusy(false);
		}
	}

	async function onResend(session: SamlSsoSessionPublicDto, bc: SamlBackchannelLogoutPublicDto) {
		try {
			await resendBackchannelLogout(session.id, bc.spConnectionId);
			showToast(t('toastResent'));
			await Promise.all([load(), loadQueueHealth()]);
		} catch (err) {
			showToast(err instanceof AdminApiError ? err.message : t('terminateFailed'));
		}
	}

	const total = data?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / SAML_SESSIONS_LIST_PAGE_SIZE));
	const selectedCount = selectedIds.size;

	return (
		<section>
			<AdminPageHeader
				title={t('title')}
				subtitle={t('subtitle')}
				breadcrumbs={[{ label: tNav('dashboard'), to: '/admin' }, { label: t('title') }]}
			/>
			<Callout variant="info">{t('limitationNote')}</Callout>
			{queueHealth ? (
				<Callout variant={queueHealth.failed + queueHealth.givenUp > 0 ? 'warning' : 'info'}>
					<strong>{t('queueHealthTitle')}</strong>{' '}
					{t('queueHealthLine', {
						pending: queueHealth.pending + queueHealth.inFlight,
						failed: queueHealth.failed,
						givenUp: queueHealth.givenUp,
						succeeded: queueHealth.succeeded + queueHealth.partial,
					})}{' '}
					<Button
						type="button"
						variant="link"
						disabled={bulkBusy}
						onClick={() => void onProcessQueue()}
					>
						{t('processQueue')}
					</Button>
				</Callout>
			) : null}
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
					<Select
						label={tIdentity('sourceFilter')}
						value={apiConnectionId}
						onChange={(e) => {
							setApiConnectionId(e.target.value);
							setPage(1);
						}}
					>
						<option value="">{tIdentity('sourceAll')}</option>
						{sources.map((s) => (
							<option key={s.apiConnectionId} value={s.apiConnectionId}>
								{s.label}
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
			{activeIds.length > 0 ? (
				<div className="evg-stack inline" role="toolbar" aria-label={t('bulkActions')}>
					<Button
						type="button"
						variant="danger"
						disabled={bulkBusy || selectedCount === 0}
						onClick={() => void onTerminateSelected()}
					>
						{t('terminateSelected')}
					</Button>
					<span className="evg-muted">{t('selectedCount', { count: selectedCount })}</span>
					<Button
						type="button"
						variant="secondary"
						disabled={bulkBusy}
						onClick={() => void onTerminateAll()}
					>
						{t('terminateAllActive')}
					</Button>
				</div>
			) : null}
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
										<th>
											{activeIds.length > 0 ? (
												<Checkbox
													label={t('selectAllActive')}
													checked={allActiveSelected}
													onChange={toggleSelectAll}
												/>
											) : null}
										</th>
										<th>{t('colUser')}</th>
										<th>{tIdentity('colSource')}</th>
										<th>{t('colServiceProviders')}</th>
										<th>{t('colPropagation')}</th>
										<th>{t('colLoginIp')}</th>
										<th>{t('colLastActive')}</th>
										<th>{tCommon('status')}</th>
										<th>{tCommon('actions')}</th>
									</tr>
								</thead>
								<tbody>
									{data.items.map((session) => (
										<tr key={session.id}>
											<td>
												{session.status === 'active' ? (
													<Checkbox
														label=""
														id={`sel-${session.id}`}
														checked={selectedIds.has(session.id)}
														onChange={(checked) => toggleRow(session.id, checked)}
													/>
												) : (
													tCommon('emDash')
												)}
											</td>
											<td>{session.username}</td>
											<td className="evg-muted">{session.sourceLabel ?? tCommon('emDash')}</td>
											<td>
												{session.participations.length === 0
													? tCommon('emDash')
													: session.participations.map((p) => p.spName).join(', ')}
											</td>
											<td>
												<BackchannelCell
													session={session}
													onResend={(bc) => void onResend(session, bc)}
												/>
											</td>
											<td className="evg-muted">{session.loginIp ?? tCommon('emDash')}</td>
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

function BackchannelCell({
	session,
	onResend,
}: {
	session: SamlSsoSessionPublicDto;
	onResend: (bc: SamlBackchannelLogoutPublicDto) => void;
}) {
	const { t } = useTranslation('samlSessions');
	const { t: tCommon } = useTranslation('common');
	const rows = session.backchannelLogouts ?? [];
	if (rows.length === 0) {
		return <span className="evg-muted">{tCommon('emDash')}</span>;
	}
	return (
		<div className="evg-stack">
			{rows.map((bc) => (
				<div key={bc.spConnectionId} className="evg-stack inline">
					<Badge variant={BC_BADGE_VARIANT[bc.status]}>{t(BC_STATUS_KEY[bc.status])}</Badge>
					<span className="evg-muted" title={bc.lastError ?? undefined}>
						{bc.spName}
						{bc.attempts > 0 ? ` · ${t('bcAttempts', { count: bc.attempts })}` : ''}
					</span>
					{bc.status === 'failed' || bc.status === 'given_up' ? (
						<Button type="button" variant="link" onClick={() => onResend(bc)}>
							{t('bcResend')}
						</Button>
					) : null}
				</div>
			))}
		</div>
	);
}
