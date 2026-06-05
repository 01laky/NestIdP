import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getSyncLog } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { syncLogStatusToBadge } from '../status-badge';
import { Badge, CodeBlock } from '../../ui';

export function SyncLogDetailPage() {
	const { syncLogId } = useParams<{ syncLogId: string }>();
	const { t } = useTranslation('sync');
	const { t: tNav } = useTranslation('nav');
	const { t: tApi } = useTranslation('apiConnections');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('syncLogDetail'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [log, setLog] = useState<Awaited<ReturnType<typeof getSyncLog>>['syncLog'] | null>(null);

	useEffect(() => {
		if (!syncLogId) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getSyncLog(syncLogId);
				if (!cancelled) {
					setLog(data.syncLog);
				}
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'sync.loadLogFailed',
								)
							: t('loadLogFailed'),
					);
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
	}, [syncLogId, t]);

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
