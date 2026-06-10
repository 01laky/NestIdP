import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { useTranslation } from 'react-i18next';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { Button, Panel, TextArea } from '../../../ui';

type TFn = ReturnType<typeof useTranslation>['t'];

/**
 * Shared frame for an IdP certificate section — the active-cert panel, the upload panel and the
 * rotation panel (Prompt 38 §A17 / §6.9). The signing and encryption sections of IdpSettingsPage shared
 * this three-panel scaffolding (status badge, fingerprint/expiry list, divider + options fields + action
 * cluster; the PEM-upload form; the rotation checklist with complete/cancel) but diverged in the crypto
 * rows shown, the available actions and the pending-rotation crypto line — those are passed as slots so the
 * rendered DOM stays identical to the original inline panels.
 */
export interface CertificateSectionProps {
	t: TFn;
	tCommon: TFn;
	busy: boolean;
	// active certificate panel
	panelTitle: string;
	statusBadge: string;
	/** Extra hint paragraph under the status badge (encryption section only). */
	panelHint?: string;
	fingerprint: string | null;
	notAfter: string | null;
	/** Kind-specific `<div className="evg-dl__row">` entries (key family + algorithm). */
	cryptoRows: ReactNode;
	/** Optional callout rendered after the detail list (encryption EC key-agreement note). */
	afterDetailList?: ReactNode;
	optionsFields: ReactNode;
	actions: ReactNode;
	// upload panel
	showUpload: boolean;
	uploadTitle: string;
	uploadCertLabel: string;
	uploadCertHint: string;
	uploadCertValue: string;
	onUploadCertChange: (value: string) => void;
	uploadKeyLabel: string;
	uploadKeyHint: string;
	uploadKeyValue: string;
	onUploadKeyChange: (value: string) => void;
	onUploadSubmit: () => void;
	onUploadCancel: () => void;
	// rotation panel
	rotationActive: boolean;
	rotationTitle: string;
	rotationStaleText: string | null;
	pendingCertTitle: string;
	pendingFingerprintText: string;
	/** Kind-specific pending-crypto summary paragraph. */
	pendingCrypto: ReactNode;
	/** Kind-specific algorithm-mismatch warning callout, or null. */
	mismatchWarning: ReactNode;
	rotationSteps: [string, string, string, string];
	openSpConnectionsLabel: string;
	completeLabel: string;
	cancelLabel: string;
	onComplete: () => void;
	onCancel: () => void;
}

export function CertificateSection(props: CertificateSectionProps) {
	const { tCommon } = props;
	return (
		<>
			<Panel title={props.panelTitle}>
				<p>
					<span className="evg-badge evg-badge--info">{props.statusBadge}</span>
				</p>
				{props.panelHint ? <p className="evg-muted">{props.panelHint}</p> : null}
				<dl className="evg-dl">
					<div className="evg-dl__row">
						<dt>{props.t('fingerprint')}</dt>
						<dd>
							<code>{props.fingerprint ?? tCommon('emDash')}</code>
						</dd>
					</div>
					<div className="evg-dl__row">
						<dt>{props.t('notAfter')}</dt>
						<dd>
							<code>{props.notAfter ?? tCommon('emDash')}</code>
						</dd>
					</div>
					{props.cryptoRows}
				</dl>
				{props.afterDetailList}
				<hr className="evg-divider" />
				{props.optionsFields}
				{props.actions}
			</Panel>

			{props.showUpload ? (
				<Panel title={props.uploadTitle}>
					<form
						className="evg-stack"
						aria-busy={props.busy}
						onSubmit={(event) => {
							event.preventDefault();
							props.onUploadSubmit();
						}}
					>
						<fieldset className="evg-stack" disabled={props.busy}>
							<TextArea
								label={props.uploadCertLabel}
								rows={6}
								hint={props.uploadCertHint}
								value={props.uploadCertValue}
								onChange={(event) => props.onUploadCertChange(event.target.value)}
							/>
							<TextArea
								label={props.uploadKeyLabel}
								rows={6}
								hint={props.uploadKeyHint}
								value={props.uploadKeyValue}
								onChange={(event) => props.onUploadKeyChange(event.target.value)}
							/>
							<div className="evg-cluster">
								<Button type="submit" variant="primary" disabled={props.busy}>
									{tCommon('upload')}
								</Button>
								<Button
									type="button"
									variant="secondary"
									disabled={props.busy}
									onClick={props.onUploadCancel}
								>
									{tCommon('cancel')}
								</Button>
							</div>
						</fieldset>
					</form>
				</Panel>
			) : null}

			{props.rotationActive ? (
				<Panel title={props.rotationTitle}>
					{props.rotationStaleText ? (
						<p className="evg-callout evg-callout--info">{props.rotationStaleText}</p>
					) : null}
					<h3 className="evg-panel__title">{props.pendingCertTitle}</h3>
					<p className="evg-muted">{props.pendingFingerprintText}</p>
					{props.pendingCrypto}
					{props.mismatchWarning}
					<ol className="evg-checklist">
						<li>{props.rotationSteps[0]}</li>
						<li>
							{props.rotationSteps[1]}{' '}
							<Link to={SP_CONNECTION_ROUTE_PREFIX}>{props.openSpConnectionsLabel}</Link>
						</li>
						<li>{props.rotationSteps[2]}</li>
						<li>{props.rotationSteps[3]}</li>
					</ol>
					<div className="evg-cluster">
						<Button
							type="button"
							variant="primary"
							disabled={props.busy}
							onClick={props.onComplete}
						>
							{props.completeLabel}
						</Button>
						<Button type="button" variant="danger" disabled={props.busy} onClick={props.onCancel}>
							{props.cancelLabel}
						</Button>
					</div>
				</Panel>
			) : null}
		</>
	);
}
