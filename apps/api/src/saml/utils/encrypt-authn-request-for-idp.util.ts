import { createCipheriv, createPublicKey, randomBytes } from 'node:crypto';
import {
	getIdpContentEncryptionOption,
	getIdpEncryptionKeyTransportOption,
	IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID,
	IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
} from '@nestidp/shared';
import { wrapSymmetricKeyWithTransport } from './saml-xml-encryption-shared.util';

const XMLENC_NS = 'http://www.w3.org/2001/04/xmlenc#';
const XMLENC11_NS = 'http://www.w3.org/2009/xmlenc11#';
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const XMLENC_ELEMENT_TYPE = 'http://www.w3.org/2001/04/xmlenc#Element';

export interface EncryptAuthnRequestForIdpOptions {
	keyTransportAlgorithmId?: string;
	contentEncryptionAlgorithmId?: string;
}

export function encryptAuthnRequestForIdp(
	plainAuthnRequestXml: string,
	idpEncryptionCertPem: string,
	options: EncryptAuthnRequestForIdpOptions = {},
): string {
	const transportId =
		options.keyTransportAlgorithmId ?? IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID;
	const contentId = options.contentEncryptionAlgorithmId ?? IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID;
	const transport = getIdpEncryptionKeyTransportOption(transportId)!;
	const content = getIdpContentEncryptionOption(contentId)!;

	const plaintext = plainAuthnRequestXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
	const cipherName = content.id === 'aes256-cbc' ? 'aes-256-cbc' : 'aes-128-cbc';
	const keyLength = content.id === 'aes256-cbc' ? 32 : 16;
	const iv = randomBytes(16);
	const aesKey = randomBytes(keyLength);

	const cipher = createCipheriv(cipherName, aesKey, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const cipherPayload = Buffer.concat([iv, ciphertext]);

	const publicKey = createPublicKey({ key: idpEncryptionCertPem, format: 'pem' });
	const encryptedKey = wrapSymmetricKeyWithTransport(aesKey, publicKey, transport.xmlKeyTransportAlgorithm);

	const encryptedDataId = `_${randomBytes(16).toString('hex')}`;
	const encryptedKeyId = `_${randomBytes(16).toString('hex')}`;

	return `<xenc:EncryptedData xmlns:xenc="${XMLENC_NS}" xmlns:ds="${XMLDSIG_NS}" Id="${encryptedDataId}" Type="${XMLENC_ELEMENT_TYPE}">
  <xenc:EncryptionMethod Algorithm="${content.xmlEncryptionMethod}"/>
  <ds:KeyInfo>
    <xenc:EncryptedKey xmlns:xenc11="${XMLENC11_NS}" Id="${encryptedKeyId}">
      <xenc:EncryptionMethod Algorithm="${transport.xmlKeyTransportAlgorithm}"/>
      <xenc:CipherData>
        <xenc:CipherValue>${encryptedKey.toString('base64')}</xenc:CipherValue>
      </xenc:CipherData>
    </xenc:EncryptedKey>
  </ds:KeyInfo>
  <xenc:CipherData>
    <xenc:CipherValue>${cipherPayload.toString('base64')}</xenc:CipherValue>
  </xenc:CipherData>
</xenc:EncryptedData>`;
}
