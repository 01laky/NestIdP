import { useTranslation } from 'react-i18next';
import type { GenerateIdpEncryptionCertRequestDto, IdpCertKeyFamily } from '@nestidp/shared';
import {
	getDefaultGenerateIdpEncryptionCertRequest,
	IDP_ENCRYPTION_CERT_MAX_VALIDITY_YEARS,
	IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS,
	listKeyTransportOptionsForKeyFamily,
} from '@nestidp/shared';
import { Button, Callout, Select, TextInput } from '../../../ui';
import { addLocalDays, addLocalYears, formatLocalYyyyMmDd } from './cert-date.utils';
import {
	DEFAULT_CERT_NOT_AFTER_DAYS,
	EC_CURVE_OPTIONS,
	RSA_MODULUS_BITS_OPTIONS,
} from './constants';
import type { EcCurveOption, RsaModulusBitsOption } from './enums';

export { buildEncryptionCertOptionsConfirmSummary } from './confirm-summary';

export function IdpEncryptionCertOptionsFields({
	value,
	onChange,
	disabled,
}: {
	value: GenerateIdpEncryptionCertRequestDto;
	onChange: (next: GenerateIdpEncryptionCertRequestDto) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslation('idpSettings');
	const keyFamily: IdpCertKeyFamily = value.keyFamily ?? 'rsa';
	const transportOptions = listKeyTransportOptionsForKeyFamily(keyFamily);
	const transportId =
		value.keyTransportAlgorithmId ?? (keyFamily === 'rsa' ? 'rsa-oaep-mgf1p' : undefined);
	const selectedTransport = IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS.find(
		(a) => a.id === transportId,
	);
	const minDate = formatLocalYyyyMmDd(new Date());
	const maxDate = addLocalYears(IDP_ENCRYPTION_CERT_MAX_VALIDITY_YEARS);
	const notAfter = value.notAfter ?? addLocalDays(DEFAULT_CERT_NOT_AFTER_DAYS);

	const showRsa15Warning = selectedTransport?.deprecated === true;
	const showEcWarning = keyFamily === 'ec';

	function resetDefaults() {
		onChange(getDefaultGenerateIdpEncryptionCertRequest());
	}

	return (
		<div className="evg-stack">
			<div className="evg-cluster evg-cluster--wrap">
				<h3 className="evg-panel__title">{t('encryption.crypto.panelTitle')}</h3>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={disabled}
					onClick={resetDefaults}
				>
					{t('encryption.crypto.resetDefaults')}
				</Button>
			</div>
			<Select
				label={t('encryption.crypto.keyFamily')}
				value={keyFamily}
				disabled={disabled}
				onChange={(event) => {
					const family = event.target.value as IdpCertKeyFamily;
					onChange({
						...value,
						keyFamily: family,
						keyTransportAlgorithmId:
							family === 'rsa' ? (value.keyTransportAlgorithmId ?? 'rsa-oaep-mgf1p') : undefined,
						rsaModulusBits: family === 'rsa' ? (value.rsaModulusBits ?? 2048) : undefined,
						ecCurve: family === 'ec' ? (value.ecCurve ?? 'P-256') : undefined,
					});
				}}
			>
				<option value="rsa">{t('encryption.crypto.keyFamilyRsa')}</option>
				<option value="ec">{t('encryption.crypto.keyFamilyEc')}</option>
			</Select>
			{keyFamily === 'rsa' ? (
				<Select
					label={t('encryption.crypto.rsaModulus')}
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
					label={t('encryption.crypto.ecCurve')}
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
			{keyFamily === 'rsa' ? (
				<Select
					label={t('encryption.crypto.keyTransportAlgorithm')}
					value={transportId ?? 'rsa-oaep-mgf1p'}
					disabled={disabled}
					onChange={(event) => onChange({ ...value, keyTransportAlgorithmId: event.target.value })}
				>
					{transportOptions.map((algo) => (
						<option key={algo.id} value={algo.id}>
							{t(`encryption.crypto.algorithms.${algo.labelKey}`)}
							{algo.deprecated ? ` (${t('encryption.crypto.deprecatedSuffix')})` : ''}
						</option>
					))}
				</Select>
			) : null}
			<TextInput
				label={t('encryption.crypto.notAfter')}
				type="date"
				required
				min={minDate}
				max={maxDate}
				disabled={disabled}
				value={notAfter}
				onChange={(event) => onChange({ ...value, notAfter: event.target.value })}
			/>
			<Callout variant="info">{t('encryption.crypto.contentEncryptionNote')}</Callout>
			{showRsa15Warning ? (
				<Callout variant="warning">{t('encryption.crypto.rsa15Deprecated')}</Callout>
			) : null}
			{showEcWarning ? (
				<Callout variant="warning">{t('encryption.crypto.spCompatibilityWarning')}</Callout>
			) : null}
		</div>
	);
}
