import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { IdpSettingsPublicDto } from '@nestidp/shared';
import {
	IDP_ROTATION_STALE_WARNING_DAYS,
	IDP_CERT_EXPIRY_WARNING_DAYS,
	SAML_NAME_ID_FORMATS,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import {
	AdminApiError,
	cancelIdpCertRotation,
	completeIdpCertRotation,
	generateIdpSigningCert,
	getIdpMetadataPreview,
	getIdpSettings,
	startIdpCertRotation,
	updateIdpSettings,
	uploadIdpSigningCert,
} from '../adminApi';
import { AdminBreadcrumbs } from '../components/AdminBreadcrumbs';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Button, CodeBlock, Panel, Select, TextArea, TextInput, useToast } from '../../ui';

function copyText(label: string, value: string): void {
	void (async () => {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			window.prompt(`Copy ${label}:`, value);
		}
	})();
}

function isExpiringSoon(notAfter: string | null): boolean {
	if (!notAfter) {
		return false;
	}
	const expiry = new Date(notAfter).getTime();
	if (Number.isNaN(expiry)) {
		return false;
	}
	const threshold = Date.now() + IDP_CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
	return expiry <= threshold;
}

function isStaleRotation(startedAt: string | null): boolean {
	if (!startedAt) {
		return false;
	}
	const started = new Date(startedAt).getTime();
	if (Number.isNaN(started)) {
		return false;
	}
	const threshold = Date.now() - IDP_ROTATION_STALE_WARNING_DAYS * 24 * 60 * 60 * 1000;
	return started <= threshold;
}

function certStatusLabel(settings: IdpSettingsPublicDto): string {
	if (settings.rotation.active) {
		return 'Rotation in progress';
	}
	if (!settings.hasSigningCertificate) {
		return 'No signing certificate';
	}
	if (isExpiringSoon(settings.signingCertNotAfter)) {
		return 'Expires soon';
	}
	return 'Certificate OK';
}

export function IdpSettingsPage() {
	useDocumentTitle('IdP Settings — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [settings, setSettings] = useState<IdpSettingsPublicDto | null>(null);
	const [entityId, setEntityId] = useState('');
	const [nameIdFormat, setNameIdFormat] = useState('');
	const [metadataPreview, setMetadataPreview] = useState<string | null>(null);
	const [showUpload, setShowUpload] = useState(false);
	const [uploadCert, setUploadCert] = useState('');
	const [uploadKey, setUploadKey] = useState('');
	const [busy, setBusy] = useState(false);
	const { showToast } = useToast();

	async function reload(): Promise<IdpSettingsPublicDto> {
		const data = await getIdpSettings();
		setSettings(data);
		setEntityId(data.entityId);
		setNameIdFormat(data.nameIdFormat);
		return data;
	}

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				await reload();
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load IdP settings');
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
	}, []);

	async function runMutation(action: () => Promise<void>): Promise<void> {
		setBusy(true);
		setError(null);
		setSuccess(null);
		try {
			await action();
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Request failed');
		} finally {
			setBusy(false);
		}
	}

	async function handleSaveEntityId(event: FormEvent) {
		event.preventDefault();
		await runMutation(async () => {
			await updateIdpSettings({ entityId });
			await reload();
			setSuccess('Entity ID updated.');
			showToast('Entity ID updated');
		});
	}

	async function handleSaveNameIdFormat(event: FormEvent) {
		event.preventDefault();
		await runMutation(async () => {
			await updateIdpSettings({ nameIdFormat });
			await reload();
			setSuccess('Default NameID format updated.');
			showToast('Default NameID format updated');
		});
	}

	async function handleGeneratePrimary() {
		if (
			!window.confirm(
				'Generate a new primary certificate? This replaces the existing primary immediately.',
			)
		) {
			return;
		}
		await runMutation(async () => {
			await generateIdpSigningCert();
			await reload();
			setSuccess('Primary signing certificate generated.');
			showToast('Primary signing certificate generated');
		});
	}

	async function handleUploadPrimary(event: FormEvent) {
		event.preventDefault();
		if (
			!window.confirm('Upload replaces the existing primary certificate immediately. Continue?')
		) {
			return;
		}
		await runMutation(async () => {
			await uploadIdpSigningCert({
				signingCertPem: uploadCert,
				signingPrivateKeyPem: uploadKey,
			});
			setShowUpload(false);
			setUploadCert('');
			setUploadKey('');
			await reload();
			setSuccess('Primary signing certificate uploaded.');
			showToast('Primary signing certificate uploaded');
		});
	}

	async function handleStartRotationGenerate() {
		if (
			!window.confirm('Start certificate rotation? Metadata will publish two signing certificates.')
		) {
			return;
		}
		await runMutation(async () => {
			await startIdpCertRotation({ mode: 'generate' });
			await reload();
			setSuccess('Rotation started with a newly generated pending certificate.');
			showToast('Certificate rotation started');
		});
	}

	async function handleCompleteRotation() {
		if (
			!window.confirm(
				'Complete rotation? Pending certificate becomes primary. SPs must already trust the new certificate.',
			)
		) {
			return;
		}
		await runMutation(async () => {
			await completeIdpCertRotation();
			await reload();
			setSuccess('Certificate rotation completed.');
			showToast('Certificate rotation completed');
		});
	}

	async function handleCancelRotation() {
		if (!window.confirm('Cancel rotation and discard the pending certificate?')) {
			return;
		}
		await runMutation(async () => {
			await cancelIdpCertRotation();
			await reload();
			setSuccess('Certificate rotation cancelled.');
			showToast('Certificate rotation cancelled');
		});
	}

	async function handleRefreshMetadataPreview() {
		await runMutation(async () => {
			const preview = await getIdpMetadataPreview();
			setMetadataPreview(preview.xml);
		});
	}

	if (loading) {
		return <LoadingState message="Loading IdP settings…" />;
	}

	if (!settings) {
		return <ErrorBanner message={error ?? 'IdP settings unavailable'} />;
	}

	return (
		<section>
			<AdminBreadcrumbs items={[{ label: 'Dashboard', to: '/admin' }, { label: 'IdP Settings' }]} />
			<AdminPageHeader
				title="IdP settings"
				subtitle="Global SAML Identity Provider configuration"
			/>
			{error ? <ErrorBanner message={error} /> : null}
			{success ? <p className="evg-success-text">{success}</p> : null}

			<Panel title="Overview">
				<ul className="evg-dl">
					<li>
						<span>Metadata URL</span>
						<code>{settings.metadataUrl}</code>
						<Button
							type="button"
							variant="link"
							size="sm"
							onClick={() => copyText('metadata URL', settings.metadataUrl)}
						>
							Copy
						</Button>
					</li>
					<li>
						<span>SSO URL</span>
						<code>{settings.ssoUrl}</code>
						<Button
							type="button"
							variant="link"
							size="sm"
							onClick={() => copyText('SSO URL', settings.ssoUrl)}
						>
							Copy
						</Button>
					</li>
					<li>
						<span>IdP base URL</span>
						<code>{settings.idpBaseUrl}</code>
					</li>
				</ul>
			</Panel>

			{settings.entityId !== settings.idpBaseUrl ? (
				<ErrorBanner message="Entity ID differs from IDP_BASE_URL. Service providers must update IdP metadata and trust after entity ID changes." />
			) : null}

			{isExpiringSoon(settings.signingCertNotAfter) ? (
				<p className="evg-callout evg-callout--warning">
					Signing certificate expires on {settings.signingCertNotAfter} — plan renewal or rotation.
				</p>
			) : null}

			<Panel title="Entity ID">
				<form
					className="evg-stack"
					aria-busy={busy}
					onSubmit={(event) => void handleSaveEntityId(event)}
				>
					<fieldset className="evg-stack" disabled={busy}>
						<TextInput
							label="Entity ID"
							name="entityId"
							value={entityId}
							onChange={(event) => setEntityId(event.target.value)}
						/>
						<Button type="submit" variant="primary" disabled={busy}>
							{busy ? 'Saving…' : 'Save entity ID'}
						</Button>
					</fieldset>
				</form>
			</Panel>

			<Panel title="Default NameID format">
				<p className="evg-muted">
					Used in IdP metadata only. Assertion NameID still comes from each SP connection.
				</p>
				<form
					className="evg-stack"
					aria-busy={busy}
					onSubmit={(event) => void handleSaveNameIdFormat(event)}
				>
					<fieldset className="evg-stack" disabled={busy}>
						<Select
							label="NameID format"
							value={nameIdFormat}
							onChange={(event) => setNameIdFormat(event.target.value)}
						>
							{SAML_NAME_ID_FORMATS.map((format) => (
								<option key={format} value={format}>
									{format}
								</option>
							))}
						</Select>
						<Button type="submit" variant="primary" disabled={busy}>
							{busy ? 'Saving…' : 'Save NameID format'}
						</Button>
					</fieldset>
				</form>
			</Panel>

			<Panel title="Signing certificate">
				<p>
					<span className="evg-badge evg-badge--info">{certStatusLabel(settings)}</span>
				</p>
				<ul className="evg-dl">
					<li>
						<span>Fingerprint (SHA-256)</span>
						<code>{settings.signingCertFingerprintSha256 ?? '—'}</code>
					</li>
					<li>
						<span>Not after</span>
						<code>{settings.signingCertNotAfter ?? '—'}</code>
					</li>
				</ul>
				<div className="evg-cluster">
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.rotation.active}
						onClick={() => void handleGeneratePrimary()}
					>
						Generate certificate
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.rotation.active}
						onClick={() => setShowUpload(true)}
					>
						Upload certificate
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || settings.rotation.active || !settings.hasSigningCertificate}
						onClick={() => void handleStartRotationGenerate()}
					>
						Start rotation (generate)
					</Button>
				</div>
			</Panel>

			{showUpload ? (
				<Panel title="Upload primary certificate">
					<form
						className="evg-stack"
						aria-busy={busy}
						onSubmit={(event) => void handleUploadPrimary(event)}
					>
						<fieldset className="evg-stack" disabled={busy}>
							<TextArea
								label="Signing certificate PEM"
								rows={6}
								hint="Paste PEM certificate."
								value={uploadCert}
								onChange={(event) => setUploadCert(event.target.value)}
							/>
							<TextArea
								label="Private key PEM"
								rows={6}
								hint="Paste PEM private key."
								value={uploadKey}
								onChange={(event) => setUploadKey(event.target.value)}
							/>
							<div className="evg-cluster">
								<Button type="submit" variant="primary" disabled={busy}>
									Upload
								</Button>
								<Button
									type="button"
									variant="secondary"
									disabled={busy}
									onClick={() => setShowUpload(false)}
								>
									Cancel
								</Button>
							</div>
						</fieldset>
					</form>
				</Panel>
			) : null}

			{settings.rotation.active ? (
				<Panel title="Certificate rotation">
					{isStaleRotation(settings.rotation.startedAt) ? (
						<p className="evg-callout evg-callout--info">
							Rotation started {settings.rotation.startedAt} — complete cutover or cancel to avoid
							prolonged dual-cert metadata.
						</p>
					) : null}
					<p className="evg-muted">
						Pending fingerprint: {settings.rotation.pendingCertFingerprintSha256 ?? '—'}
					</p>
					<ol className="evg-checklist">
						<li>
							Verify metadata preview shows two signing KeyDescriptor entries (primary + pending).
						</li>
						<li>
							Update SP trust — distribute updated IdP metadata to every SP.{' '}
							<Link to={SP_CONNECTION_ROUTE_PREFIX}>Open SP connections</Link>
						</li>
						<li>Test SSO with at least one SP-initiated login before completing rotation.</li>
						<li>Complete rotation only after steps 1–3.</li>
					</ol>
					<div className="evg-cluster">
						<Button
							type="button"
							variant="primary"
							disabled={busy}
							onClick={() => void handleCompleteRotation()}
						>
							Complete rotation
						</Button>
						<Button
							type="button"
							variant="danger"
							disabled={busy}
							onClick={() => void handleCancelRotation()}
						>
							Cancel rotation
						</Button>
					</div>
				</Panel>
			) : null}

			<Panel title="Metadata preview">
				<Button
					type="button"
					variant="secondary"
					disabled={busy}
					onClick={() => void handleRefreshMetadataPreview()}
				>
					Refresh preview
				</Button>
				{metadataPreview ? <CodeBlock>{metadataPreview}</CodeBlock> : null}
			</Panel>

			<p className="evg-callout evg-callout--info">
				Lazy auto-generation still exists as a dev/test fallback when no certificate is configured,
				but operators should configure signing material explicitly in production.
			</p>
		</section>
	);
}
