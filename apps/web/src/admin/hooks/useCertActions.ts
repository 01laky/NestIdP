import type { useTranslation } from 'react-i18next';
import type { useConfirm } from '../../ui';

type TFn = ReturnType<typeof useTranslation>['t'];
type ConfirmFn = ReturnType<typeof useConfirm>;

/**
 * The i18n keys a {@link useCertActions} kind needs. Signing and encryption supply the same shape with
 * their own (mostly `encryption.`-prefixed) keys; the two type-to-confirm challenge labels
 * (`typeReplaceToConfirm` / `typeCompleteToConfirm`) are shared and live in the hook.
 */
export interface CertActionKeys {
	confirmGenerateTitle: string;
	confirmGenerate: string;
	generateLabel: string;
	successGenerated: string;
	toastGenerated: string;
	confirmUploadTitle: string;
	confirmUpload: string;
	uploadLabel: string;
	successUploaded: string;
	toastUploaded: string;
	confirmStartRotationTitle: string;
	confirmStartRotation: string;
	startRotationLabel: string;
	successRotationStarted: string;
	toastRotationStarted: string;
	confirmCompleteTitle: string;
	confirmComplete: string;
	completeLabel: string;
	successCompleted: string;
	toastCompleted: string;
	confirmCancelTitle: string;
	confirmCancel: string;
	cancelLabel: string;
	successCancelled: string;
	toastCancelled: string;
}

/** Per-kind (signing / encryption) configuration for the five primary-cert + rotation actions. */
export interface CertActionConfig<TOptions> {
	keys: CertActionKeys;
	options: TOptions;
	buildSummary: (options: TOptions, t: TFn) => string;
	generate: (options: TOptions) => Promise<unknown>;
	startRotation: (options: TOptions) => Promise<unknown>;
	/** Reads the kind's upload-PEM state; returns once the upload request resolves. */
	upload: () => Promise<unknown>;
	/** Clears the kind's upload form/modal state after a successful upload. */
	onUploadSuccess: () => void;
	complete: () => Promise<unknown>;
	cancel: () => Promise<unknown>;
}

/** The shared page-level helpers every cert action needs. */
export interface CertActionContext {
	t: TFn;
	confirm: ConfirmFn;
	runMutation: (action: () => Promise<void>) => Promise<void>;
	reload: () => Promise<unknown>;
	refreshMetadataPreview: () => Promise<void>;
	setSuccess: (message: string) => void;
	showToast: (message: string) => void;
}

export interface CertActions {
	generatePrimary: () => Promise<void>;
	uploadPrimary: () => Promise<void>;
	startRotationGenerate: () => Promise<void>;
	completeRotation: () => Promise<void>;
	cancelRotation: () => Promise<void>;
}

/**
 * Unifies the signing/encryption cert-action handler mirror in IdpSettingsPage (Prompt 38 §A17 / §6.9).
 * The ten near-identical `handle*` / `handle*Encryption*` functions differed only by their i18n keys, the
 * `adminApi` call, the options object and the confirm summary — all supplied via {@link CertActionConfig}.
 * Behaviour-preserving: same confirm dialogs (REPLACE / COMPLETE type-to-confirm challenges), same
 * reload + metadata-refresh sequencing, same success/toast messaging as the original inline handlers.
 */
export function useCertActions<TOptions>(
	config: CertActionConfig<TOptions>,
	ctx: CertActionContext,
): CertActions {
	const { keys } = config;
	const { t, confirm, runMutation, reload, refreshMetadataPreview, setSuccess, showToast } = ctx;

	async function generatePrimary() {
		const ok = await confirm({
			title: t(keys.confirmGenerateTitle),
			description: `${t(keys.confirmGenerate)}\n\n${config.buildSummary(config.options, t)}`,
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'REPLACE', label: t('typeReplaceToConfirm') },
			confirmLabel: t(keys.generateLabel),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await config.generate(config.options);
			await reload();
			await refreshMetadataPreview();
			setSuccess(t(keys.successGenerated));
			showToast(t(keys.toastGenerated));
		});
	}

	async function uploadPrimary() {
		const ok = await confirm({
			title: t(keys.confirmUploadTitle),
			description: t(keys.confirmUpload),
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'REPLACE', label: t('typeReplaceToConfirm') },
			confirmLabel: t(keys.uploadLabel),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await config.upload();
			config.onUploadSuccess();
			await reload();
			setSuccess(t(keys.successUploaded));
			showToast(t(keys.toastUploaded));
		});
	}

	async function startRotationGenerate() {
		const ok = await confirm({
			title: t(keys.confirmStartRotationTitle),
			description: `${t(keys.confirmStartRotation)}\n\n${config.buildSummary(config.options, t)}`,
			tone: 'warning',
			showAuditNote: true,
			confirmLabel: t(keys.startRotationLabel),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await config.startRotation(config.options);
			await reload();
			await refreshMetadataPreview();
			setSuccess(t(keys.successRotationStarted));
			showToast(t(keys.toastRotationStarted));
		});
	}

	async function completeRotation() {
		const ok = await confirm({
			title: t(keys.confirmCompleteTitle),
			description: t(keys.confirmComplete),
			tone: 'warning',
			showAuditNote: true,
			typeToConfirm: { challenge: 'COMPLETE', label: t('typeCompleteToConfirm') },
			confirmLabel: t(keys.completeLabel),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await config.complete();
			await reload();
			setSuccess(t(keys.successCompleted));
			showToast(t(keys.toastCompleted));
		});
	}

	async function cancelRotation() {
		const ok = await confirm({
			title: t(keys.confirmCancelTitle),
			description: t(keys.confirmCancel),
			tone: 'warning',
			confirmLabel: t(keys.cancelLabel),
		});
		if (!ok) {
			return;
		}
		await runMutation(async () => {
			await config.cancel();
			await reload();
			setSuccess(t(keys.successCancelled));
			showToast(t(keys.toastCancelled));
		});
	}

	return {
		generatePrimary,
		uploadPrimary,
		startRotationGenerate,
		completeRotation,
		cancelRotation,
	};
}
