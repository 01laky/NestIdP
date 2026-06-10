import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { getSpConnection, getSpConnectionTestSsoUrl } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { mapAdminError } from '../../i18n/api-error-messages';
import { Button, Callout, Checkbox, TextArea, useToast } from '../../ui';

const EXAMPLE_SCRIPT = 'docs/examples/saml-sp-initiated-redirect.mjs';

export function SpConnectionTestSsoPage() {
	const { id } = useParams<{ id: string }>();
	const { t } = useTranslation('spConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const { showToast } = useToast();
	const [spName, setSpName] = useState('');
	useAdminDocumentTitle(t('testSsoTitle'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [entityId, setEntityId] = useState('');
	const [ssoUrl, setSsoUrl] = useState('');
	const [testSsoUrl, setTestSsoUrl] = useState('');
	const [testSsoWarning, setTestSsoWarning] = useState<string | null>(null);
	const [signed, setSigned] = useState(false);
	const [encrypted, setEncrypted] = useState(false);
	const [command, setCommand] = useState('');

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const sp = await getSpConnection(id);
				if (!cancelled) {
					setSpName(sp.name);
				}
			} catch (err) {
				if (!cancelled) {
					setError(mapAdminError(err, 'spConnections.loadSsoHelperFailed'));
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
	}, [id, t]);

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		setError(null);
		void (async () => {
			try {
				const result = await getSpConnectionTestSsoUrl(id, {
					signed,
					encrypted,
				});
				if (!cancelled) {
					const resolvedSsoUrl = result.ssoUrl.split('?')[0] ?? '';
					setEntityId(result.spEntityId);
					setSsoUrl(resolvedSsoUrl);
					setTestSsoUrl(result.ssoUrl);
					setTestSsoWarning(
						result.warning === 'signed_with_ephemeral_key_verify_sp_cert_matches'
							? t('testSsoEphemeralKeyWarning')
							: result.warning === 'ec_key_agreement_sp_compat'
								? t('testSsoEcKeyAgreementWarning')
								: (result.warning ?? null),
					);
					setCommand(
						`node ${EXAMPLE_SCRIPT} --sso-url ${resolvedSsoUrl} --sp-entity-id ${result.spEntityId}`,
					);
				}
			} catch (err) {
				if (!cancelled) {
					setError(mapAdminError(err, 'spConnections.loadSsoHelperFailed'));
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
	}, [encrypted, id, signed, t]);

	async function handleCopyTestSsoUrl() {
		try {
			await navigator.clipboard.writeText(testSsoUrl);
			showToast(t('testSsoUrlCopied'));
		} catch {
			showToast(tCommon('copyFailed'));
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={`${t('testSsoTitle')} — ${spName}`}
				subtitle={t('testSsoSubtitle')}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: t('listTitle'), to: SP_CONNECTION_ROUTE_PREFIX },
					{ label: spName, to: `${SP_CONNECTION_ROUTE_PREFIX}/${id}` },
					{ label: t('testSsoTitle') },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<p className="evg-muted">{t('testSsoHelp')}</p>
			<ul className="evg-dl">
				<li>
					<span>{t('spEntityId')}</span>
					<code>{entityId}</code>
				</li>
				<li>
					<span>{t('idpSsoUrl')}</span>
					<code>{ssoUrl}</code>
				</li>
			</ul>
			<section className="evg-panel" aria-label={t('testSsoUrlTitle')}>
				<h2 className="evg-panel__title">{t('testSsoUrlTitle')}</h2>
				<div className="evg-stack">
					<Checkbox
						label={t('testSsoSignedToggle')}
						checked={signed}
						onChange={setSigned}
						id="test-sso-signed-toggle"
					/>
					<Checkbox
						label={t('testSsoEncryptedToggle')}
						checked={encrypted}
						onChange={setEncrypted}
						id="test-sso-encrypted-toggle"
					/>
					<TextArea
						label={t('testSsoUrlLabel')}
						readOnly
						rows={5}
						value={testSsoUrl}
						onFocus={(event) => event.target.select()}
					/>
					<div className="evg-cluster">
						<Button type="button" variant="secondary" onClick={() => void handleCopyTestSsoUrl()}>
							{tCommon('copy')}
						</Button>
					</div>
					<Callout variant="warning">{t('testSsoWarningCallout')}</Callout>
					{testSsoWarning ? <Callout variant="warning">{testSsoWarning}</Callout> : null}
					<p className="evg-muted">
						<Link to={`${SP_CONNECTION_ROUTE_PREFIX}/${id}#probe-sp-signing`}>
							{t('probeSigningOpenEditLink')}
						</Link>
					</p>
				</div>
			</section>
			<section className="evg-panel" aria-label={t('exampleCommand')}>
				<h2 className="evg-panel__title">{t('exampleCommand')}</h2>
				<TextArea
					label={tCommon('command')}
					readOnly
					rows={3}
					value={command}
					onFocus={(e) => e.target.select()}
					hint={t('commandHint')}
				/>
			</section>
			<p>
				<Link className="evg-btn evg-btn--link" to={`${SP_CONNECTION_ROUTE_PREFIX}/${id}`}>
					{t('backToSp')}
				</Link>
			</p>
		</section>
	);
}
