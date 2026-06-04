import { useTranslation } from 'react-i18next';
import type { GenerateIdpSigningCertRequestDto, IdpSigningKeyFamily } from '@nestidp/shared';
import {
	getDefaultGenerateIdpSigningCertRequest,
	IDP_SIGNING_CERT_MAX_VALIDITY_YEARS,
	IDP_SIGNING_SIGNATURE_ALGORITHMS,
	listSignatureOptionsForKeyFamily,
} from '@nestidp/shared';
import { Button, Callout, Select, TextInput } from '../../ui';

function formatLocalYyyyMmDd(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function addLocalDays(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return formatLocalYyyyMmDd(d);
}

function addLocalYears(years: number): string {
	const d = new Date();
	d.setFullYear(d.getFullYear() + years);
	return formatLocalYyyyMmDd(d);
}

export function IdpSigningCertOptionsFields({
	value,
	onChange,
	disabled,
}: {
	value: GenerateIdpSigningCertRequestDto;
	onChange: (next: GenerateIdpSigningCertRequestDto) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslation('idpSettings');
	const keyFamily: IdpSigningKeyFamily = value.keyFamily ?? 'rsa';
	const algorithms = listSignatureOptionsForKeyFamily(keyFamily);
	const signatureId =
		value.signatureAlgorithmId ?? (keyFamily === 'ec' ? 'ecdsa-sha256' : 'rsa-sha256');
	const selectedAlgo = IDP_SIGNING_SIGNATURE_ALGORITHMS.find((a) => a.id === signatureId);
	const minDate = formatLocalYyyyMmDd(new Date());
	const maxDate = addLocalYears(IDP_SIGNING_CERT_MAX_VALIDITY_YEARS);
	const notAfter = value.notAfter ?? addLocalDays(730);

	const showSha1Warning = selectedAlgo?.deprecated === true;
	const showEcWarning = keyFamily === 'ec';

	function resetDefaults() {
		onChange(getDefaultGenerateIdpSigningCertRequest());
	}

	return (
		<div className="evg-stack">
			<div className="evg-cluster evg-cluster--wrap">
				<h3 className="evg-panel__title">{t('crypto.panelTitle')}</h3>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={disabled}
					onClick={resetDefaults}
				>
					{t('crypto.resetDefaults')}
				</Button>
			</div>
			<Select
				label={t('crypto.keyFamily')}
				value={keyFamily}
				disabled={disabled}
				onChange={(event) => {
					const family = event.target.value as IdpSigningKeyFamily;
					onChange({
						...value,
						keyFamily: family,
						signatureAlgorithmId: family === 'ec' ? 'ecdsa-sha256' : 'rsa-sha256',
						rsaModulusBits: family === 'rsa' ? (value.rsaModulusBits ?? 2048) : undefined,
						ecCurve: family === 'ec' ? (value.ecCurve ?? 'P-256') : undefined,
					});
				}}
			>
				<option value="rsa">{t('crypto.keyFamilyRsa')}</option>
				<option value="ec">{t('crypto.keyFamilyEc')}</option>
			</Select>
			{keyFamily === 'rsa' ? (
				<Select
					label={t('crypto.rsaModulus')}
					value={String(value.rsaModulusBits ?? 2048)}
					disabled={disabled}
					onChange={(event) =>
						onChange({
							...value,
							rsaModulusBits: Number(event.target.value) as 2048 | 3072 | 4096,
						})
					}
				>
					<option value="2048">2048</option>
					<option value="3072">3072</option>
					<option value="4096">4096</option>
				</Select>
			) : (
				<Select
					label={t('crypto.ecCurve')}
					value={value.ecCurve ?? 'P-256'}
					disabled={disabled}
					onChange={(event) =>
						onChange({
							...value,
							ecCurve: event.target.value as 'P-256' | 'P-384' | 'P-521',
						})
					}
				>
					<option value="P-256">P-256</option>
					<option value="P-384">P-384</option>
					<option value="P-521">P-521</option>
				</Select>
			)}
			<Select
				label={t('crypto.signatureAlgorithm')}
				value={signatureId}
				disabled={disabled}
				onChange={(event) => onChange({ ...value, signatureAlgorithmId: event.target.value })}
			>
				{algorithms.map((algo) => (
					<option key={algo.id} value={algo.id}>
						{t(`crypto.algorithms.${algo.labelKey}`)}
						{algo.deprecated ? ` (${t('crypto.deprecatedSuffix')})` : ''}
					</option>
				))}
			</Select>
			<TextInput
				label={t('crypto.notAfter')}
				type="date"
				required
				min={minDate}
				max={maxDate}
				disabled={disabled}
				value={notAfter}
				onChange={(event) => onChange({ ...value, notAfter: event.target.value })}
			/>
			{showSha1Warning ? <Callout variant="warning">{t('crypto.sha1Deprecated')}</Callout> : null}
			{showEcWarning ? (
				<Callout variant="warning">{t('crypto.spCompatibilityWarning')}</Callout>
			) : null}
		</div>
	);
}

export function buildCertOptionsConfirmSummary(
	value: GenerateIdpSigningCertRequestDto,
	t: (key: string, opts?: Record<string, string>) => string,
): string {
	const family = value.keyFamily ?? 'rsa';
	const detail =
		family === 'rsa' ? `${value.rsaModulusBits ?? 2048} bit` : (value.ecCurve ?? 'P-256');
	const algo = value.signatureAlgorithmId ?? (family === 'ec' ? 'ecdsa-sha256' : 'rsa-sha256');
	return t('confirmGenerateSummary', {
		family,
		detail,
		algorithm: algo,
		notAfter: value.notAfter ?? '',
	});
}
