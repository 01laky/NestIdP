import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AUDIT_ACTOR_TYPES, AUDIT_CATEGORIES } from '@nestidp/shared';
import { auditExportUrl, listAuditEvents } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { mapAdminError, resolveI18nKey } from '../../i18n/api-error-messages';
import { auditEventLabel } from '../../i18n/audit-event-labels';
import { auditCategoryLabel } from '../../i18n/enum-labels';
import { Button, Select, Table, TextInput, useToast } from '../../ui';

const PAGE_SIZE = 50;

const ACTOR_TYPE_LABEL_KEYS: Record<(typeof AUDIT_ACTOR_TYPES)[number], string> = {
	admin: 'actorTypeAdmin',
	end_user: 'actorTypeEndUser',
	system: 'actorTypeSystem',
};

export function AuditLogPage() {
	const { t } = useTranslation('audit');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('title'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [category, setCategory] = useState('');
	const [event, setEvent] = useState('');
	const [actorType, setActorType] = useState('');
	const [subjectType, setSubjectType] = useState('');
	const [subjectId, setSubjectId] = useState('');
	const [data, setData] = useState<Awaited<ReturnType<typeof listAuditEvents>> | null>(null);
	const [page, setPage] = useState(1);
	const { showToast } = useToast();

	function filterParams(): Record<string, string> {
		const params: Record<string, string> = {};
		if (category) {
			params.category = category;
		}
		if (event.trim()) {
			params.event = event.trim();
		}
		if (actorType) {
			params.actorType = actorType;
		}
		if (subjectType.trim()) {
			params.subjectType = subjectType.trim();
		}
		if (subjectId.trim()) {
			params.subjectId = subjectId.trim();
		}
		return params;
	}

	async function load(nextPage: number) {
		setLoading(true);
		setError(null);
		try {
			const params: Record<string, string> = {
				limit: String(PAGE_SIZE),
				offset: String((nextPage - 1) * PAGE_SIZE),
				...filterParams(),
			};
			const result = await listAuditEvents(params);
			setData(result);
			setPage(nextPage);
		} catch (err) {
			setError(mapAdminError(err, 'audit.loadFailed'));
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void load(1);
		// Initial load only; Filter button and pagination call load() explicitly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function download(format: 'json' | 'csv') {
		const params: Record<string, string> = { format, ...filterParams() };
		window.open(auditExportUrl(params), '_blank');
		showToast(t('toastExportDownloaded'));
	}

	const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

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
						void load(1);
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
					<Select
						label={t('actorType')}
						value={actorType}
						onChange={(e) => setActorType(e.target.value)}
					>
						<option value="">{tCommon('all')}</option>
						{AUDIT_ACTOR_TYPES.map((type) => (
							<option key={type} value={type}>
								{t(ACTOR_TYPE_LABEL_KEYS[type])}
							</option>
						))}
					</Select>
					<TextInput
						label={t('subjectType')}
						value={subjectType}
						onChange={(e) => setSubjectType(e.target.value)}
					/>
					<TextInput
						label={t('subjectId')}
						value={subjectId}
						onChange={(e) => setSubjectId(e.target.value)}
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
										<td>{auditEventLabel(row.event, resolveI18nKey)}</td>
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
					<div className="evg-stack inline">
						<Button
							type="button"
							variant="ghost"
							disabled={page <= 1}
							onClick={() => void load(page - 1)}
						>
							{tCommon('paginationPrevious')}
						</Button>
						<span className="evg-muted">
							{tCommon('paginationPage', { current: page, totalPages })}
						</span>
						<Button
							type="button"
							variant="ghost"
							disabled={page >= totalPages}
							onClick={() => void load(page + 1)}
						>
							{tCommon('paginationNext')}
						</Button>
					</div>
				</>
			) : null}
		</section>
	);
}
