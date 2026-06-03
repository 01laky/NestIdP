import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getIdpMetadataUrl, getSpConnection } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Panel, TextArea } from '../../ui';

const EXAMPLE_SCRIPT = 'docs/examples/saml-sp-initiated-redirect.mjs';

export function SpConnectionTestSsoPage() {
	const { id } = useParams<{ id: string }>();
	useDocumentTitle('Test SSO — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [spName, setSpName] = useState('');
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
					setError(err instanceof AdminApiError ? err.message : 'Failed to load SSO helper');
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
	}, [id]);

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={`Test SSO — ${spName}`}
				subtitle="SP-initiated redirect (manual)"
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'SP connections', to: SP_CONNECTION_ROUTE_PREFIX },
					{ label: spName, to: `${SP_CONNECTION_ROUTE_PREFIX}/${id}` },
					{ label: 'Test SSO' },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<p className="evg-muted">
				Use the example script to build a signed AuthnRequest redirect URL. Open the printed URL in
				a browser after syncing a test user.
			</p>
			<ul className="evg-dl">
				<li>
					<span>SP Entity ID</span>
					<code>{entityId}</code>
				</li>
				<li>
					<span>IdP SSO URL</span>
					<code>{ssoUrl}</code>
				</li>
			</ul>
			<Panel title="Example command">
				<TextArea
					label="Command"
					readOnly
					rows={3}
					value={command}
					onFocus={(e) => e.target.select()}
					hint="Click the field to select all text for copying."
				/>
			</Panel>
			<p>
				<Link className="evg-btn evg-btn--link" to={`${SP_CONNECTION_ROUTE_PREFIX}/${id}`}>
					Back to SP
				</Link>
			</p>
		</section>
	);
}
