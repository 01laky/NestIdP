import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
	ConnectExternalDbRequest,
	ExternalDbDialect,
	ExternalDbPreviewResponseDto,
	ExternalDbSslMode,
	ExternalDbStatusResponseDto,
} from '@nestidp/shared';
import { EXTERNAL_DB_DIALECTS, EXTERNAL_DB_SSL_MODES } from '@nestidp/shared';
import {
	connectExternalIdentityDb,
	disconnectExternalIdentityDb,
	getExternalIdentityDbStatus,
	previewExternalIdentityDb,
	resyncExternalIdentityDb,
	testExternalIdentityDb,
} from '../adminApi';
import {
	Button,
	Callout,
	Checkbox,
	LoadingState,
	PageHeader,
	Panel,
	Select,
	TextArea,
	TextInput,
	useConfirm,
	useToast,
} from '../../ui';

interface FormState {
	dialect: ExternalDbDialect;
	host: string;
	port: string;
	database: string;
	username: string;
	password: string;
	sslMode: ExternalDbSslMode;
	sslCaCertPem: string;
	pgSchema: string;
	keepLocalCopy: boolean;
	acknowledgeBackup: boolean;
}

const EMPTY_FORM: FormState = {
	dialect: 'postgres',
	host: '',
	port: '5432',
	database: '',
	username: '',
	password: '',
	sslMode: 'require',
	sslCaCertPem: '',
	pgSchema: '',
	keepLocalCopy: false,
	acknowledgeBackup: false,
};

function buildRequest(form: FormState): ConnectExternalDbRequest {
	return {
		dialect: form.dialect,
		host: form.host.trim(),
		port: Number(form.port),
		database: form.database.trim(),
		username: form.username.trim(),
		password: form.password.length > 0 ? form.password : undefined,
		sslMode: form.sslMode,
		sslCaCertPem: form.sslCaCertPem.trim() || null,
		pgSchema: form.pgSchema.trim() || null,
		keepLocalCopy: form.keepLocalCopy,
		acknowledgeBackup: form.acknowledgeBackup,
	};
}

export function ExternalIdentityDatabasePage() {
	const { t } = useTranslation('externalDb');
	const { showToast } = useToast();
	const confirm = useConfirm();

	const [status, setStatus] = useState<ExternalDbStatusResponseDto | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [form, setForm] = useState<FormState>(EMPTY_FORM);
	const [preview, setPreview] = useState<ExternalDbPreviewResponseDto | null>(null);

	const refresh = useCallback(async () => {
		const next = await getExternalIdentityDbStatus();
		setStatus(next);
	}, []);

	useEffect(() => {
		void refresh().finally(() => setLoading(false));
	}, [refresh]);

	const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
		setForm((prev) => ({ ...prev, [key]: value }));

	const onTest = async () => {
		setBusy(true);
		try {
			const res = await testExternalIdentityDb(buildRequest(form));
			showToast(res.ok ? t('testOk') : t('testFailed', { error: res.error ?? '' }));
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const onPreview = async () => {
		setBusy(true);
		setPreview(null);
		try {
			setPreview(await previewExternalIdentityDb(buildRequest(form)));
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const onConnect = async () => {
		setBusy(true);
		try {
			const res = await connectExternalIdentityDb(buildRequest(form));
			if (res.wipeSkipped) {
				showToast(t('wipeSkipped'));
			} else if (res.backupPath) {
				showToast(t('backupPath', { path: res.backupPath }));
			} else {
				showToast(t('connected'));
			}
			setForm(EMPTY_FORM);
			setPreview(null);
			setStatus(res.status);
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const onResync = async () => {
		setBusy(true);
		try {
			setStatus(await resyncExternalIdentityDb());
			showToast(t('resynced'));
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const onDisconnect = async () => {
		const relocate = status?.mode === 'relocate';
		const moveDataToLocal = await confirm({
			title: t('disconnectTitle'),
			description: relocate ? t('disconnectMoveHint') : t('disconnectMirrorHint'),
			confirmLabel: t('moveDataToLocal'),
			cancelLabel: t('cancel'),
			tone: 'default',
		});
		if (!moveDataToLocal) {
			return;
		}
		setBusy(true);
		try {
			setStatus(await disconnectExternalIdentityDb({ moveDataToLocal: true }));
			showToast(t('disconnected'));
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	if (loading) {
		return <LoadingState />;
	}

	const configured = status?.configured === true;

	return (
		<div>
			<PageHeader title={t('title')} subtitle={t('subtitle')} />

			<Panel title={t('status')}>
				{configured ? (
					<dl className="evg-detail-grid">
						<div>
							<dt>{t('statusLabel')}</dt>
							<dd data-testid="external-db-status">{status?.status}</dd>
						</div>
						<div>
							<dt>{t('mode')}</dt>
							<dd>{status?.mode === 'relocate' ? t('modeRelocate') : t('modeMirror')}</dd>
						</div>
						<div>
							<dt>{t('reachableLabel')}</dt>
							<dd>{status?.reachable ? t('reachable') : t('unreachable')}</dd>
						</div>
						<div>
							<dt>{t('outOfSync')}</dt>
							<dd>{status?.outOfSync ? t('yes') : t('no')}</dd>
						</div>
						{status?.counts ? (
							<div>
								<dt>{t('counts')}</dt>
								<dd>{`${status.counts.users} / ${status.counts.groups} / ${status.counts.roles}`}</dd>
							</div>
						) : null}
					</dl>
				) : (
					<p>{t('notConfigured')}</p>
				)}
				{configured ? (
					<div className="evg-form-actions">
						<Button variant="secondary" onClick={() => void onResync()} disabled={busy}>
							{t('resyncButton')}
						</Button>
						<Button variant="danger" onClick={() => void onDisconnect()} disabled={busy}>
							{t('disconnectButton')}
						</Button>
					</div>
				) : null}
			</Panel>

			{configured ? null : (
				<Panel title={t('connectTitle')}>
					<Callout variant="warning">{t('atRestWarning')}</Callout>
					<form
						className="evg-form"
						onSubmit={(e) => {
							e.preventDefault();
							void onConnect();
						}}
					>
						<Select
							label={t('dialect')}
							value={form.dialect}
							onChange={(e) => update('dialect', e.target.value as ExternalDbDialect)}
						>
							{EXTERNAL_DB_DIALECTS.map((d) => (
								<option key={d} value={d}>
									{d}
								</option>
							))}
						</Select>
						<TextInput
							label={t('host')}
							value={form.host}
							onChange={(e) => update('host', e.target.value)}
							required
						/>
						<TextInput
							label={t('port')}
							type="number"
							value={form.port}
							onChange={(e) => update('port', e.target.value)}
							required
						/>
						<TextInput
							label={t('database')}
							value={form.database}
							onChange={(e) => update('database', e.target.value)}
							required
						/>
						<TextInput
							label={t('username')}
							value={form.username}
							onChange={(e) => update('username', e.target.value)}
							required
						/>
						<TextInput
							label={t('password')}
							type="password"
							value={form.password}
							onChange={(e) => update('password', e.target.value)}
							hint={status?.hasPassword ? t('passwordKeep') : undefined}
						/>
						<Select
							label={t('sslMode')}
							value={form.sslMode}
							onChange={(e) => update('sslMode', e.target.value as ExternalDbSslMode)}
						>
							{EXTERNAL_DB_SSL_MODES.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</Select>
						<TextArea
							label={t('caCert')}
							value={form.sslCaCertPem}
							onChange={(e) => update('sslCaCertPem', e.target.value)}
							rows={3}
						/>
						<TextInput
							label={t('pgSchema')}
							value={form.pgSchema}
							onChange={(e) => update('pgSchema', e.target.value)}
						/>
						<Checkbox
							label={t('keepLocalCopy')}
							hint={t('keepLocalCopyHint')}
							checked={form.keepLocalCopy}
							onChange={(checked) => update('keepLocalCopy', checked)}
						/>
						{!form.keepLocalCopy ? (
							<>
								<Callout variant="warning">{t('connectRelocateWarning')}</Callout>
								<Checkbox
									label={t('ackBackup')}
									checked={form.acknowledgeBackup}
									onChange={(checked) => update('acknowledgeBackup', checked)}
								/>
							</>
						) : null}

						<div className="evg-form-actions">
							<Button
								type="button"
								variant="secondary"
								onClick={() => void onTest()}
								disabled={busy}
							>
								{t('testButton')}
							</Button>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void onPreview()}
								disabled={busy}
							>
								{t('previewButton')}
							</Button>
							<Button type="submit" variant="primary" disabled={busy}>
								{busy ? t('saving') : t('connectButton')}
							</Button>
						</div>
					</form>

					{preview ? (
						<div data-testid="external-db-preview" className="evg-preview">
							<h3>{t('previewTitle')}</h3>
							{preview.error ? <Callout variant="danger">{preview.error}</Callout> : null}
							<p>
								{t('previewOwnership')}:{' '}
								{preview.ownership === 'empty'
									? t('ownershipEmpty')
									: preview.ownership === 'ours'
										? t('ownershipOurs')
										: t('ownershipForeign')}
							</p>
							<p>
								{t('toCreate')}:{' '}
								{`${preview.toCreate.users} / ${preview.toCreate.groups} / ${preview.toCreate.roles}`}
							</p>
							<p>
								{t('toUpdate')}:{' '}
								{`${preview.toUpdate.users} / ${preview.toUpdate.groups} / ${preview.toUpdate.roles}`}
							</p>
							{preview.conflicts.length > 0 ? (
								<Callout variant="danger">
									{t('conflicts')}:{' '}
									{preview.conflicts.map((c) => `${c.table}.${c.kind}=${c.value}`).join(', ')}
								</Callout>
							) : null}
							{preview.willWipeLocal ? (
								<Callout variant="warning">{t('willWipeLocal')}</Callout>
							) : null}
						</div>
					) : null}
				</Panel>
			)}
		</div>
	);
}
