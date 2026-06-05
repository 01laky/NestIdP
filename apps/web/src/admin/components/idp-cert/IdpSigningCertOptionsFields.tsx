import { useTranslation } from 'react-i18next';
import type { GenerateIdpSigningCertRequestDto, IdpSigningKeyFamily } from '@nestidp/shared';
import {
	getDefaultGenerateIdpSigningCertRequest,
	IDP_SIGNING_CERT_MAX_VALIDITY_YEARS,
	IDP_SIGNING_SIGNATURE_ALGORITHMS,
	listSignatureOptionsForKeyFamily,
} from '@nestidp/shared';
import { Button, Callout, Select, TextInput } from '../../../ui';
import { addLocalDays, addLocalYears, formatLocalYyyyMmDd } from './cert-date.utils';
import {
	DEFAULT_CERT_NOT_AFTER_DAYS,
	EC_CURVE_OPTIONS,
	RSA_MODULUS_BITS_OPTIONS,
} from './constants';
import type { EcCurveOption, RsaModulusBitsOption } from './enums';

export { buildCertOptionsConfirmSummary } from './confirm-summary';

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
	const notAfter = value.notAfter ?? addLocalDays(DEFAULT_CERT_NOT_AFTER_DAYS);

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
							rsaModulusBits: Number(event.target.value) as RsaModulusBitsOption,
						})
					}
				>
					{RSA_MODULUS_BITS_OPTIONS.map((bits) => (
						<option key={bits} value={String(bits)}>
							{bits}
						</option>
					))}
				</Select>
			) : (
				<Select
					label={t('crypto.ecCurve')}
					value={value.ecCurve ?? 'P-256'}
					disabled={disabled}
					onChange={(event) =>
						onChange({
							...value,
							ecCurve: event.target.value as EcCurveOption,
						})
					}
				>
					{EC_CURVE_OPTIONS.map((curve) => (
						<option key={curve} value={curve}>
							{curve}
						</option>
					))}
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
