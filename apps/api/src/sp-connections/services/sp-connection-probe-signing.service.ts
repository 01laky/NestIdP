import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProbeSpSigningRequestDto, ProbeSpSigningResponseDto } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import { assertValidSpCertificatePem } from '../utils/sp-certificate.util';
import { buildSignedAuthnRequestRedirectQuery } from '../../saml/utils/sign-authn-request-redirect.util';
import {
	buildRedirectBindingSignedContent,
	verifyRedirectBindingSignature,
} from '../../saml/utils/saml-authn-request-redirect-signature.util';
import { fingerprintSha256Hex } from '../../idp-settings/utils/idp-cert.util';
import { MAX_PEM_LENGTH } from '../../common/constants/crypto-limits';
import { SpConnectionsAuditService } from './sp-connections-audit.service';

@Injectable()
export class SpConnectionProbeSigningService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly audit: SpConnectionsAuditService,
	) {}

	async probeSigning(
		id: string,
		body: ProbeSpSigningRequestDto,
	): Promise<ProbeSpSigningResponseDto> {
		const sp = await this.prisma.spConnection.findUnique({ where: { id } });
		if (!sp) {
			throw new NotFoundException('Service Provider connection not found');
		}

		const spCertificate = assertValidSpCertificatePem(sp.spCertificate);
		if (!spCertificate) {
			throw new BadRequestException('SP certificate PEM is required');
		}

		const privateKeyPem = body.spPrivateKeyPem?.trim();
		if (!privateKeyPem || privateKeyPem.length > MAX_PEM_LENGTH) {
			throw new BadRequestException('Valid spPrivateKeyPem is required');
		}

		const samlRequestRaw = encodeURIComponent('dGVzdA==');
		const signed = buildSignedAuthnRequestRedirectQuery({
			samlRequestRaw,
			spPrivateKeyPem: privateKeyPem,
		});

		const sigAlgDecoded = decodeURIComponent(signed.sigAlg);
		const signedContent = buildRedirectBindingSignedContent({
			samlRequestRaw,
			sigAlgRaw: signed.sigAlg,
		});

		const ok = verifyRedirectBindingSignature({
			signedContent,
			signatureBase64UrlEncoded: signed.signature,
			sigAlgUri: sigAlgDecoded,
			certificatePem: spCertificate,
		});

		this.audit.logSigningProbe(sp.id, sp.spEntityId, ok);

		if (!ok) {
			return { ok: false, message: 'Private key does not match SP certificate' };
		}

		return {
			ok: true,
			fingerprintSha256: fingerprintSha256Hex(spCertificate),
		};
	}
}
