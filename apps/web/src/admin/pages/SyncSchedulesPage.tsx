import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_CONNECTION_ROUTE_PREFIX, type SchedulesOverviewResponseDto } from '@nestidp/shared';
import { getSchedulesOverview } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { Badge, Panel, Table } from '../../ui';

function stateBadge(item: SchedulesOverviewResponseDto['schedules'][number]) {
	if (!item.scheduleEnabled) {
		return { variant: 'neutral' as const, key: 'schedule.stateDisabled' };
	}
	if (item.schedulePaused) {
		return { variant: 'warning' as const, key: 'schedule.statePaused' };
	}
	return { variant: 'success' as const, key: 'schedule.stateEnabled' };
}

export function SyncSchedulesPage() {
	const { t } = useTranslation('sync');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('schedule.overview.title'));
	const [data, setData] = useState<SchedulesOverviewResponseDto | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await getSchedulesOverview();
				if (!cancelled) {
					setData(res);
				}
			} catch {
				if (!cancelled) {
					setError(t('schedule.overview.loadFailed'));
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [t]);

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={t('schedule.overview.title')}
				subtitle={t('schedule.overview.subtitle')}
				breadcrumbs={[{ label: tNav('dashboard'), to: '/admin' }, { label: tNav('schedules') }]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			{data ? (
				<>
					<p>
						<Badge variant={data.schedulerEnabled ? 'success' : 'neutral'}>
							{data.schedulerEnabled
								? t('schedule.overview.schedulerEnabled')
								: t('schedule.overview.schedulerDisabled')}
						</Badge>{' '}
						<span className="evg-muted">
							{t('schedule.overview.manualRuns')}: {data.manualRunCount} ·{' '}
							{t('schedule.overview.scheduledRuns')}: {data.scheduledRunCount}
						</span>
					</p>
					{data.schedules.length === 0 ? (
						<Panel title={t('schedule.overview.title')}>
							<p className="evg-muted">{t('schedule.overview.empty')}</p>
						</Panel>
					) : (
						<Table>
							<thead>
								<tr>
									<th>{t('schedule.overview.colConnection')}</th>
									<th>{t('schedule.overview.colState')}</th>
									<th>{t('schedule.overview.colCron')}</th>
									<th>{t('schedule.overview.colTimezone')}</th>
									<th>{t('schedule.overview.colNextRun')}</th>
									<th>{t('schedule.overview.colLastRun')}</th>
									<th>{t('schedule.overview.colFailures')}</th>
								</tr>
							</thead>
							<tbody>
								{data.schedules.map((item) => {
									const badge = stateBadge(item);
									return (
										<tr key={item.connectionId}>
											<td>
												<Link to={`${API_CONNECTION_ROUTE_PREFIX}/${item.connectionId}/sync`}>
													{item.connectionName}
												</Link>
											</td>
											<td>
												<Badge variant={badge.variant}>{t(badge.key)}</Badge>
												{item.scheduleDryRun ? (
													<>
														{' '}
														<Badge variant="info">{t('schedule.dryRunBadge')}</Badge>
													</>
												) : null}
											</td>
											<td>
												{item.scheduleCron ? <code>{item.scheduleCron}</code> : tCommon('emDash')}
											</td>
											<td>{item.scheduleTimezone ?? tCommon('emDash')}</td>
											<td>{item.nextRunAt ?? tCommon('emDash')}</td>
											<td>
												{item.lastScheduledRunAt ? (
													<>
														{item.lastScheduledRunAt}{' '}
														{item.lastScheduledRunStatus ? (
															<Badge
																variant={
																	item.lastScheduledRunStatus === 'SUCCESS' ? 'success' : 'danger'
																}
															>
																{item.lastScheduledRunStatus}
															</Badge>
														) : null}
													</>
												) : (
													tCommon('emDash')
												)}
											</td>
											<td>{item.scheduleConsecutiveFailures}</td>
										</tr>
									);
								})}
							</tbody>
						</Table>
					)}
				</>
			) : null}
		</section>
	);
}
