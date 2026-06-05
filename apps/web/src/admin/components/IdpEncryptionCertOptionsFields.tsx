import { useTranslation } from 'react-i18next';
import type { GenerateIdpEncryptionCertRequestDto, IdpCertKeyFamily } from '@nestidp/shared';
import {
	getDefaultGenerateIdpEncryptionCertRequest,
	IDP_ENCRYPTION_CERT_MAX_VALIDITY_YEARS,
	IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS,
	listKeyTransportOptionsForKeyFamily,
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
	const notAfter = value.notAfter ?? addLocalDays(730);

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
					label={t('encryption.crypto.ecCurve')}
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

export function buildEncryptionCertOptionsConfirmSummary(
	value: GenerateIdpEncryptionCertRequestDto,
	t: (key: string, opts?: Record<string, string>) => string,
): string {
	const family = value.keyFamily ?? 'rsa';
	const detail =
		family === 'rsa' ? `${value.rsaModulusBits ?? 2048} bit` : (value.ecCurve ?? 'P-256');
	const algo =
		family === 'rsa'
			? (value.keyTransportAlgorithmId ?? 'rsa-oaep-mgf1p')
			: t('encryption.crypto.ecNoKeyTransport');
	return t('encryption.confirmGenerateSummary', {
		family,
		detail,
		algorithm: algo,
		notAfter: value.notAfter ?? '',
	});
}
