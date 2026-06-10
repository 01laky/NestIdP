import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { getSyncLog } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminResource } from '../hooks/useAdminResource';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { syncLogStatusToBadge } from '../status-badge';
import { Badge, CodeBlock } from '../../ui';

export function SyncLogDetailPage() {
	const { syncLogId } = useParams<{ syncLogId: string }>();
	const { t } = useTranslation('sync');
	const { t: tNav } = useTranslation('nav');
	const { t: tApi } = useTranslation('apiConnections');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('syncLogDetail'));
	const { data, loading, error } = useAdminResource(() => getSyncLog(syncLogId as string), {
		fallbackKey: 'sync.loadLogFailed',
		deps: [syncLogId],
	});
	const log = data?.syncLog ?? null;

	if (loading) {
		return <LoadingState />;
	}

	if (error) {
		return <ErrorBanner message={error} />;
	}

	if (!log) {
		return <ErrorBanner message={t('syncLogNotFound')} />;
	}

	return (
		<section>
			<AdminPageHeader
				title={t('syncLogDetail')}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tApi('listTitle'), to: API_CONNECTION_ROUTE_PREFIX },
					{ label: log.id },
				]}
			/>
			<ul className="evg-dl">
				<li>
					<span>{tCommon('status')}</span>
					<Badge variant={syncLogStatusToBadge(log.status)}>{log.status}</Badge>
				</li>
				<li>
					<span>{tCommon('started')}</span>
					<code>{log.startedAt}</code>
				</li>
				<li>
					<span>{tCommon('finished')}</span>
					<code>{log.finishedAt ?? tCommon('emDash')}</code>
				</li>
				<li>
					<span>{t('dryRunField')}</span>
					<code>{String(log.dryRun)}</code>
				</li>
			</ul>
			{log.errors && log.errors.length > 0 ? (
				<CodeBlock>{JSON.stringify(log.errors, null, 2)}</CodeBlock>
			) : (
				<p className="evg-muted">{t('noErrorsRecorded')}</p>
			)}
			<p>
				<Link className="evg-btn evg-btn--link" to={API_CONNECTION_ROUTE_PREFIX}>
					{t('backToApiConnections')}
				</Link>
			</p>
		</section>
	);
}
