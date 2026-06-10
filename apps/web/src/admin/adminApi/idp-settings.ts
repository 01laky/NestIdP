import type {
	GenerateIdpEncryptionCertRequestDto,
	GenerateIdpSigningCertRequestDto,
	IdpMetadataPreviewResponseDto,
	IdpSettingsPublicDto,
	StartIdpCertRotationRequestDto,
	StartIdpEncryptionCertRotationRequestDto,
	UpdateIdpSettingsRequestDto,
	UploadIdpEncryptionCertRequestDto,
	UploadIdpSigningCertRequestDto,
} from '@nestidp/shared';
import { IDP_SETTINGS_API_PATH } from '@nestidp/shared';
import { adminFetch } from './core';

export function getIdpSettings(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(IDP_SETTINGS_API_PATH);
}

export function updateIdpSettings(
	body: UpdateIdpSettingsRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(IDP_SETTINGS_API_PATH, {
		method: 'PATCH',
		body: JSON.stringify(body),
	});
}

export function runCertRotationCheck(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/cert-rotation/run-check`, {
		method: 'POST',
	});
}

export function generateIdpSigningCert(
	body: GenerateIdpSigningCertRequestDto = {},
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/generate`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function uploadIdpSigningCert(
	body: UploadIdpSigningCertRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/upload`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function startIdpCertRotation(
	body: StartIdpCertRotationRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/start`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function completeIdpCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/complete`,
		{
			method: 'POST',
		},
	);
}

export function cancelIdpCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/signing-cert/rotation/cancel`, {
		method: 'POST',
	});
}

export function generateIdpEncryptionCert(
	body: GenerateIdpEncryptionCertRequestDto = {},
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/encryption-cert/generate`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function uploadIdpEncryptionCert(
	body: UploadIdpEncryptionCertRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(`${IDP_SETTINGS_API_PATH}/encryption-cert/upload`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
}

export function startIdpEncryptionCertRotation(
	body: StartIdpEncryptionCertRotationRequestDto,
): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/start`,
		{
			method: 'POST',
			body: JSON.stringify(body),
		},
	);
}

export function completeIdpEncryptionCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/complete`,
		{
			method: 'POST',
		},
	);
}

export function cancelIdpEncryptionCertRotation(): Promise<IdpSettingsPublicDto> {
	return adminFetch<IdpSettingsPublicDto>(
		`${IDP_SETTINGS_API_PATH}/encryption-cert/rotation/cancel`,
		{
			method: 'POST',
		},
	);
}

export function getIdpEncryptionCertPublicPem(): Promise<{ certPem: string }> {
	return adminFetch<{ certPem: string }>(`${IDP_SETTINGS_API_PATH}/encryption-cert/public-pem`);
}

export function getIdpMetadataPreview(): Promise<IdpMetadataPreviewResponseDto> {
	return adminFetch<IdpMetadataPreviewResponseDto>(`${IDP_SETTINGS_API_PATH}/metadata-preview`);
}
