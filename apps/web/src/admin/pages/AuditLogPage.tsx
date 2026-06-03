import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AUDIT_CATEGORIES } from '@nestidp/shared';
import { AdminApiError, auditExportUrl, getCsrfToken, listAuditEvents } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { auditCategoryLabel } from '../../i18n/enum-labels';
import { Button, Select, Table, TextInput, useToast } from '../../ui';

export function AuditLogPage() {
	const { t } = useTranslation('audit');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('title'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [category, setCategory] = useState('');
	const [event, setEvent] = useState('');
	const [data, setData] = useState<Awaited<ReturnType<typeof listAuditEvents>> | null>(null);
	const { showToast } = useToast();

	async function load() {
		setLoading(true);
		setError(null);
		const params: Record<string, string> = { limit: '50', offset: '0' };
		if (category) {
			params.category = category;
		}
		if (event.trim()) {
			params.event = event.trim();
		}
		const result = await listAuditEvents(params);
		setData(result);
		setLoading(false);
	}

	useEffect(() => {
		void load().catch((err) => {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(err.statusCode, err.message, resolveI18nKey, 'audit.loadFailed')
					: t('loadFailed'),
			);
			setLoading(false);
		});
		// Initial load only; Filter button calls load() explicitly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function download(format: 'json' | 'csv') {
		const params: Record<string, string> = { format };
		if (category) {
			params.category = category;
		}
		if (event.trim()) {
			params.event = event.trim();
		}
		window.open(auditExportUrl(params), '_blank');
		showToast(t('toastExportDownloaded'));
	}

	return (
		<section>
			<AdminPageHeader
				title={t('title')}
				subtitle={t('subtitle')}
				breadcrumbs={[{ label: tNav('dashboard'), to: '/admin' }, { label: t('title') }]}
				actions={
					<>
						<Button type="button" variant="link" onClick={() => download('csv')}>
							{t('exportCsv')}
						</Button>
						<Button type="button" variant="link" onClick={() => download('json')}>
							{t('exportJson')}
						</Button>
					</>
				}
			/>
			<details className="evg-filters-panel evg-filters-panel--collapsible">
				<summary>{t('filters')}</summary>
				<form
					className="evg-stack inline"
					onSubmit={(e) => {
						e.preventDefault();
						void load();
					}}
				>
					<Select
						label={tCommon('category')}
						value={category}
						onChange={(e) => setCategory(e.target.value)}
					>
						<option value="">{tCommon('all')}</option>
						{AUDIT_CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{auditCategoryLabel(c, resolveI18nKey)}
							</option>
						))}
					</Select>
					<TextInput
						label={tCommon('event')}
						value={event}
						onChange={(e) => setEvent(e.target.value)}
						placeholder={t('eventPlaceholder')}
					/>
					<Button type="submit" variant="primary">
						{tCommon('filter')}
					</Button>
				</form>
			</details>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{data && !loading ? (
				<>
					<p className="evg-muted">
						{t('showingEvents', { shown: data.items.length, total: data.total })}
					</p>
					<div className="evg-table-wrap">
						<Table>
							<thead>
								<tr>
									<th>{tCommon('time')}</th>
									<th>{tCommon('category')}</th>
									<th>{tCommon('event')}</th>
									<th>{tCommon('actor')}</th>
									<th>{tCommon('subject')}</th>
								</tr>
							</thead>
							<tbody>
								{data.items.map((row) => (
									<tr key={row.id}>
										<td className="evg-muted">{new Date(row.createdAt).toLocaleString()}</td>
										<td>{auditCategoryLabel(row.category, resolveI18nKey)}</td>
										<td>{row.event}</td>
										<td>{row.actorLabel ?? row.actorType}</td>
										<td>
											{row.subjectType
												? `${row.subjectType}:${row.subjectId ?? ''}`
												: tCommon('emDash')}
											{row.metadata &&
											typeof row.metadata === 'object' &&
											'syncLogId' in row.metadata &&
											typeof row.metadata.syncLogId === 'string' ? (
												<>
													{' '}
													<Link to={`/admin/sync-logs/${row.metadata.syncLogId}`}>
														{t('syncLogLink')}
													</Link>
												</>
											) : null}
										</td>
									</tr>
								))}
							</tbody>
						</Table>
					</div>
				</>
			) : null}
			{getCsrfToken() ? null : null}
		</section>
	);
}
