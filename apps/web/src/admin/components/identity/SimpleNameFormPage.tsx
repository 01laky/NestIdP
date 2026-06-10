import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AdminPageHeader } from '../layout/AdminPageHeader';
import { ErrorBanner } from '../common/ErrorBanner';
import { LoadingState } from '../common/LoadingState';
import { useAdminDocumentTitle } from '../../../i18n/useAdminDocumentTitle';
import { mapAdminError } from '../../../i18n/api-error-messages';
import { Button, ButtonLink, Panel, TextInput, useToast } from '../../../ui';

/**
 * Per-kind configuration for {@link SimpleNameFormPage} (Prompt 38 §A17 / §6.9). The group and role
 * create/edit pages were ~95% identical — only the API calls, response field, routes and i18n keys
 * differed. Each kind supplies those here; `load`/`create`/`update` already unwrap the `{ group }` /
 * `{ role }` response envelope and (for create/update) return the detail route to navigate to. All `keys`
 * are looked up in the `identity` namespace except `navList` (`nav` namespace) and `loadFailed`
 * (fully-qualified for {@link mapAdminError}).
 */
export interface SimpleNameFormConfig {
	load(id: string): Promise<{ name: string; isManual: boolean }>;
	create(name: string): Promise<string>;
	update(id: string, name: string): Promise<string>;
	detailRoute(id: string): string;
	listPath: string;
	keys: {
		docTitleNew: string;
		docTitleEdit: string;
		loadFailed: string;
		navList: string;
		managedBySync: string;
		view: string;
		panel: string;
		create: string;
		toastCreated: string;
		toastSaved: string;
	};
}

/** Config-driven create/edit page for a manual identity record that has only a single `name` field. */
export function SimpleNameFormPage({ config }: { config: SimpleNameFormConfig }) {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const { keys } = config;
	useAdminDocumentTitle(isNew ? t(keys.docTitleNew) : t(keys.docTitleEdit));
	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [readOnlySynced, setReadOnlySynced] = useState(false);
	const [name, setName] = useState('');
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (isNew || !id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await config.load(id);
				if (cancelled) {
					return;
				}
				if (!data.isManual) {
					setReadOnlySynced(true);
				}
				setName(data.name);
			} catch (err) {
				if (!cancelled) {
					setError(mapAdminError(err, keys.loadFailed));
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
		// eslint-disable-next-line react-hooks/exhaustive-deps -- load on id change; config is stable per kind
	}, [id, isNew]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		if (readOnlySynced) {
			return;
		}
		setSaving(true);
		try {
			if (isNew) {
				const route = await config.create(name.trim());
				showToast(t(keys.toastCreated));
				navigate(route);
			} else if (id) {
				const route = await config.update(id, name.trim());
				showToast(t(keys.toastSaved));
				navigate(route);
			}
		} catch (err) {
			setError(mapAdminError(err, 'errors.saveFailed'));
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	if (readOnlySynced && id) {
		return (
			<section>
				<ErrorBanner message={t(keys.managedBySync)} />
				<p>
					<ButtonLink variant="link" to={config.detailRoute(id)}>
						{t(keys.view)}
					</ButtonLink>
				</p>
			</section>
		);
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? t(keys.docTitleNew) : t(keys.docTitleEdit)}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav(keys.navList), to: config.listPath },
					{ label: isNew ? tCommon('new') : name || tCommon('edit') },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<form className="evg-stack" onSubmit={(e) => void handleSubmit(e)} aria-busy={saving}>
				<Panel title={t(keys.panel)}>
					<TextInput
						label={tCommon('name')}
						value={name}
						onChange={(e) => setName(e.target.value)}
						requiredMark
						disabled={saving}
					/>
				</Panel>
				<p className="evg-actions">
					<Button type="submit" disabled={saving}>
						{isNew ? t(keys.create) : tCommon('save')}
					</Button>
					<ButtonLink variant="link" to={config.listPath}>
						{tCommon('cancel')}
					</ButtonLink>
				</p>
			</form>
		</section>
	);
}
