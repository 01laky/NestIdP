import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	SAML_SESSIONS_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import type { SchedulesOverviewResponseDto } from '@nestidp/shared';
import { AdminApiError, getAdminDashboard, getSchedulesOverview } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Badge, Callout, Panel, StatCard } from '../../ui';
import {
	certStatusLabel,
	certStatusToBadge,
	encryptionCertStatusLabel,
	encryptionCertStatusToBadge,
	lastSyncStatusToBadge,
} from '../status-badge';

export function DashboardPage() {
	const { t } = useTranslation('dashboard');
	const { t: tCommon } = useTranslation('common');
	const { t: tNav } = useTranslation('nav');
	useAdminDocumentTitle(t('title'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getAdminDashboard>> | null>(
		null,
	);
	const [schedules, setSchedules] = useState<SchedulesOverviewResponseDto | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const overview = await getSchedulesOverview();
				if (!cancelled) {
					setSchedules(overview);
				}
			} catch {
				// Scheduler summary is best-effort; the dashboard renders without it.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await getAdminDashboard();
				if (!cancelled) {
					setDashboard(data);
				}
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'dashboard.loadFailed',
								)
							: t('loadFailed'),
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
	}, [t]);

	if (loading) {
		return <LoadingState message={t('loading')} />;
	}

	if (error) {
		return <ErrorBanner message={error} />;
	}

	if (!dashboard) {
		return <ErrorBanner message={t('unavailable')} />;
	}

	const { counts } = dashboard;
	const { spSecurity } = dashboard;

	return (
		<section>
			<AdminPageHeader title={t('title')} subtitle={t('subtitle')} />
			<div className="evg-stats-grid evg-stats-grid--dashboard">
				<StatCard label={t('statUsers')} value={counts.users} />
				<StatCard label={t('statGroups')} value={counts.groups} />
				<StatCard label={t('statRoles')} value={counts.roles} />
				<StatCard label={t('statApiConnections')} value={counts.apiConnections} />
				<StatCard label={t('statSpConnections')} value={counts.spConnections} />
				<StatCard label={t('activeSamlSessionsLabel')} value={spSecurity.activeSamlSessions} />
			</div>
			{dashboard.apiConnection ? (
				<Panel title={t('identitySource')}>
					<p>
						<strong>{dashboard.apiConnection.name}</strong> — {t('lastSync')}{' '}
						<Badge variant={lastSyncStatusToBadge(dashboard.lastSyncStatus ?? 'NEVER')}>
							{dashboard.lastSyncStatus ?? tCommon('never')}
						</Badge>
						{dashboard.lastSyncAt ? (
							<span className="evg-muted">
								{' '}
								{tCommon('at')} {dashboard.lastSyncAt}
							</span>
						) : null}
					</p>
					<p>
						<Link
							className="evg-btn evg-btn--link"
							to={`${API_CONNECTION_ROUTE_PREFIX}/${dashboard.apiConnection.id}/sync`}
						>
							{t('openSync')}
						</Link>
					</p>
				</Panel>
			) : (
				<p className="evg-muted">
					{t('noApiConnection')}{' '}
					<Link className="evg-btn evg-btn--link" to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>
						{t('createOne')}
					</Link>
					.
				</p>
			)}
			{schedules && (schedules.schedules.length > 0 || !schedules.schedulerEnabled) ? (
				<Panel title={t('schedulerSummary')}>
					<p>
						<Badge variant={schedules.schedulerEnabled ? 'success' : 'neutral'}>
							{schedules.schedulerEnabled ? t('schedulerOn') : t('schedulerOff')}
						</Badge>{' '}
						<span className="evg-muted">
							{t('schedulerCounts', {
								enabled: schedules.schedules.filter((s) => s.scheduleEnabled && !s.schedulePaused)
									.length,
								paused: schedules.schedules.filter((s) => s.schedulePaused).length,
							})}
						</span>
					</p>
					<p>
						<Link className="evg-btn evg-btn--link" to="/admin/sync-schedules">
							{t('openSchedules')}
						</Link>
					</p>
				</Panel>
			) : null}
			<Panel title={t('idpConfiguration')}>
				<p>
					<Badge variant={certStatusToBadge(dashboard.idp.certStatus)}>
						{certStatusLabel(dashboard.idp.certStatus)}
					</Badge>
				</p>
				<p>
					<Link className="evg-btn evg-btn--link" to={dashboard.idp.idpSettingsRoute}>
						{t('configureIdpSettings')}
					</Link>
				</p>
				{dashboard.idp.hasSigningCertificate &&
				dashboard.idp.signingKeyFamily &&
				dashboard.idp.signingSignatureAlgorithmId ? (
					<p className="evg-muted">
						{t('idpSigningSummary', {
							family: dashboard.idp.signingKeyFamily.toUpperCase(),
							detail:
								dashboard.idp.signingKeyFamily === 'rsa'
									? `${dashboard.idp.signingRsaModulusBits ?? 2048} bit`
									: (dashboard.idp.signingEcCurve ?? 'P-256'),
							algorithm: dashboard.idp.signingSignatureAlgorithmId,
							date: dashboard.idp.signingCertNotAfter ?? tCommon('emDash'),
						})}
					</p>
				) : null}
				{dashboard.idp.hasEncryptionCertificate &&
				dashboard.idp.encryptionKeyFamily &&
				(dashboard.idp.encryptionKeyTransportAlgorithmId ||
					dashboard.idp.encryptionKeyFamily === 'ec') ? (
					<p className="evg-muted">
						{t('idpEncryptionSummary', {
							family: dashboard.idp.encryptionKeyFamily.toUpperCase(),
							detail:
								dashboard.idp.encryptionKeyFamily === 'rsa'
									? `${dashboard.idp.encryptionRsaModulusBits ?? 2048} bit`
									: (dashboard.idp.encryptionEcCurve ?? 'P-256'),
							algorithm:
								dashboard.idp.encryptionKeyTransportAlgorithmId ??
								t('idpSettings:encryption.crypto.ecNoKeyTransport'),
							date: dashboard.idp.encryptionCertNotAfter ?? tCommon('emDash'),
						})}
					</p>
				) : dashboard.idp.encryptionCertStatus === 'not_configured' ? (
					<p className="evg-muted">
						<Badge variant={encryptionCertStatusToBadge('not_configured')}>
							{encryptionCertStatusLabel('not_configured')}
						</Badge>
					</p>
				) : null}
				{dashboard.idp.rotationActive ? (
					<p className="evg-muted">{t('completeRotationCallout')}</p>
				) : null}
				{dashboard.idp.encryptionRotationActive ? (
					<p className="evg-muted">{t('completeEncryptionRotationCallout')}</p>
				) : null}
				{dashboard.idp.certStatus === 'expiring_soon' && dashboard.idp.signingCertNotAfter ? (
					<p className="evg-muted">
						{t('certExpiresOn', { date: dashboard.idp.signingCertNotAfter })}
					</p>
				) : null}
				{dashboard.idp.encryptionCertStatus === 'expiring_soon' &&
				dashboard.idp.encryptionCertNotAfter ? (
					<p className="evg-muted">
						{t('encryptionCertExpiresOn', { date: dashboard.idp.encryptionCertNotAfter })}
					</p>
				) : null}
				<dl className="evg-dl">
					<div className="evg-dl__row">
						<dt>{tCommon('entityId')}</dt>
						<dd>
							<code>{dashboard.entityId}</code>
						</dd>
					</div>
					<div className="evg-dl__row">
						<dt>{t('metadataUrl')}</dt>
						<dd>
							<a href={dashboard.metadataUrl} target="_blank" rel="noreferrer">
								{dashboard.metadataUrl}
							</a>
						</dd>
					</div>
					<div className="evg-dl__row">
						<dt>{tCommon('sso')}</dt>
						<dd>
							<code>{dashboard.ssoUrl}</code>
						</dd>
					</div>
				</dl>
			</Panel>
			<Panel title={t('operations')}>
				<p>
					<Link className="evg-btn evg-btn--link" to={dashboard.auditEventsRoute}>
						{tNav('auditLog')}
					</Link>{' '}
					·{' '}
					<Link className="evg-btn evg-btn--link" to={dashboard.adminUsersRoute}>
						{tNav('adminAccounts')}
					</Link>
				</p>
				<p className="evg-muted">{t('releaseNote')}</p>
			</Panel>
			<Panel title={t('spSecurity.title')}>
				{spSecurity.spConnectionsMissingCertWithSecurityFlags > 0 ? (
					<Callout variant="warning">
						{t('spSecurity.missingCertWarning', {
							count: spSecurity.spConnectionsMissingCertWithSecurityFlags,
						})}{' '}
						<Link to={SP_CONNECTION_ROUTE_PREFIX}>{t('spSecurity.openSpConnections')}</Link>
					</Callout>
				) : null}
				<p className="evg-muted">
					{t('spSecurity.requireSignedAuthnCount', {
						count: spSecurity.spConnectionsRequireSignedAuthn,
					})}
				</p>
				<p className="evg-muted">
					{t('spSecurity.requireEncryptedAssertionsCount', {
						count: spSecurity.spConnectionsRequireEncryptedAssertions,
					})}
				</p>
				{spSecurity.idpAdvertisesSignedAuthnRequests &&
				spSecurity.spConnectionsRequireSignedAuthn === 0 ? (
					<p className="evg-muted">{t('spSecurity.idpAdvertisesWithoutEnforcement')}</p>
				) : null}
				{spSecurity.idpEncryptionKeyIsEc ? (
					<Callout variant="info">{t('spSecurity.ecKeyAdvisory')}</Callout>
				) : null}
				{spSecurity.backchannelUnresolved > 0 ? (
					<Callout variant="warning" role="alert">
						{t('spSecurity.backchannelUnresolved', { count: spSecurity.backchannelUnresolved })}
						<br />
						<Link to={SAML_SESSIONS_ROUTE_PREFIX}>{t('spSecurity.openSessions')}</Link>
					</Callout>
				) : (
					<p className="evg-muted">{t('spSecurity.backchannelAllResolved')}</p>
				)}
			</Panel>
			{dashboard.syncSources && dashboard.syncSources.length > 0 ? (
				<Panel title={t('syncSourcesTitle')}>
					<p className="evg-muted">
						{t('syncSourcesCount', { count: dashboard.syncSources.length })}
					</p>
					{dashboard.syncSourceHealth && dashboard.syncSourceHealth.unhealthy > 0 ? (
						<Callout variant="warning" role="alert">
							{t('staleSourcesWarning', { count: dashboard.syncSourceHealth.unhealthy })}{' '}
							<Link to={API_CONNECTION_ROUTE_PREFIX}>{t('spSecurity.openSpConnections')}</Link>
						</Callout>
					) : null}
				</Panel>
			) : null}
			{dashboard.lockouts ? (
				<Panel title={t('securityLockoutsTitle')}>
					{dashboard.lockouts.lockedAdminAccounts + dashboard.lockouts.lockedUserAccounts > 0 ? (
						<Callout variant="warning" role="alert">
							{t('lockedAdmins')}: {dashboard.lockouts.lockedAdminAccounts} · {t('lockedUsers')}:{' '}
							{dashboard.lockouts.lockedUserAccounts}
						</Callout>
					) : (
						<>
							<p className="evg-muted">
								{t('lockedAdmins')}: {dashboard.lockouts.lockedAdminAccounts}
							</p>
							<p className="evg-muted">
								{t('lockedUsers')}: {dashboard.lockouts.lockedUserAccounts}
							</p>
						</>
					)}
				</Panel>
			) : null}
			<p className="evg-muted">
				<Link className="evg-btn evg-btn--link" to={`${IDENTITY_ROUTE_PREFIX}/users`}>
					{t('browseUsers')}
				</Link>{' '}
				·{' '}
				<Link className="evg-btn evg-btn--link" to={SP_CONNECTION_ROUTE_PREFIX}>
					{tNav('spConnections')}
				</Link>
			</p>
		</section>
	);
}
