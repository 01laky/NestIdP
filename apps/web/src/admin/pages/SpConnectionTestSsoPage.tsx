import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getIdpMetadataUrl, getSpConnection } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Panel, TextArea } from '../../ui';

const EXAMPLE_SCRIPT = 'docs/examples/saml-sp-initiated-redirect.mjs';

export function SpConnectionTestSsoPage() {
	const { id } = useParams<{ id: string }>();
	const { t } = useTranslation('spConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const [spName, setSpName] = useState('');
	useAdminDocumentTitle(t('testSsoTitle'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [entityId, setEntityId] = useState('');
	const [ssoUrl, setSsoUrl] = useState('');
	const [command, setCommand] = useState('');

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const [sp, idp] = await Promise.all([getSpConnection(id), getIdpMetadataUrl()]);
				if (!cancelled) {
					setSpName(sp.name);
					setEntityId(sp.spEntityId);
					setSsoUrl(idp.ssoUrl);
					setCommand(
						`node ${EXAMPLE_SCRIPT} --sso-url ${idp.ssoUrl} --sp-entity-id ${sp.spEntityId}`,
					);
				}
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'spConnections.loadSsoHelperFailed',
								)
							: t('loadSsoHelperFailed'),
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
	}, [id, t]);

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
			<Panel title={t('exampleCommand')}>
				<TextArea
					label={tCommon('command')}
					readOnly
					rows={3}
					value={command}
					onFocus={(e) => e.target.select()}
					hint={t('commandHint')}
				/>
			</Panel>
			<p>
				<Link className="evg-btn evg-btn--link" to={`${SP_CONNECTION_ROUTE_PREFIX}/${id}`}>
					{t('backToSp')}
				</Link>
			</p>
		</section>
	);
}
