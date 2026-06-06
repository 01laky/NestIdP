import type { SpAttributeMappingConfig, SpConnectionPublicDto } from '@nestidp/shared';
import type { SpConnection } from '@prisma/client';

export function toSpConnectionPublicDto(row: SpConnection): SpConnectionPublicDto {
	return {
		id: row.id,
		name: row.name,
		spEntityId: row.spEntityId,
		acsUrl: row.acsUrl,
		sloUrl: row.sloUrl ?? null,
		nameIdFormat: row.nameIdFormat,
		attributeMapping: (row.attributeMapping ?? null) as SpAttributeMappingConfig | null,
		active: row.active,
		hasSpCertificate: row.spCertificate != null && row.spCertificate.length > 0,
		wantAssertionsEncrypted: row.wantAssertionsEncrypted,
		wantAuthnRequestsSigned: row.wantAuthnRequestsSigned,
		wantLogoutRequestsSigned: row.wantLogoutRequestsSigned,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
