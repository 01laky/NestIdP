import { createCipheriv, createPublicKey, randomBytes, type KeyObject } from 'node:crypto';
import { wrapSymmetricKeyWithTransport } from './saml-xml-encryption-shared.util';
import {
	getIdpContentEncryptionOption,
	getIdpEncryptionKeyTransportOption,
	IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID,
	IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
} from '@nestidp/shared';

const XMLENC_NS = 'http://www.w3.org/2001/04/xmlenc#';
const XMLENC11_NS = 'http://www.w3.org/2009/xmlenc11#';
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const XMLENC_ELEMENT_TYPE = 'http://www.w3.org/2001/04/xmlenc#Element';

export class SamlAssertionEncryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SamlAssertionEncryptionError';
	}
}

export interface EncryptSignedAssertionOptions {
	keyTransportAlgorithmId?: string;
	contentEncryptionAlgorithmId?: string;
}

export function encryptSignedAssertionForSp(
	signedAssertionXml: string,
	spCertificatePem: string,
	options: EncryptSignedAssertionOptions = {},
): string {
	const transportId =
		options.keyTransportAlgorithmId ?? IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID;
	const contentId =
		options.contentEncryptionAlgorithmId ?? IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID;

	const transport = getIdpEncryptionKeyTransportOption(transportId);
	const content = getIdpContentEncryptionOption(contentId);
	if (!transport) {
		throw new SamlAssertionEncryptionError(`Unknown key transport algorithm: ${transportId}`);
	}
	if (!content) {
		throw new SamlAssertionEncryptionError(`Unknown content encryption algorithm: ${contentId}`);
	}

	const plaintext = signedAssertionXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
	if (!plaintext.includes('Assertion')) {
		throw new SamlAssertionEncryptionError('Expected signed SAML Assertion XML');
	}

	const cipherName = content.id === 'aes256-cbc' ? 'aes-256-cbc' : 'aes-128-cbc';
	const keyLength = content.id === 'aes256-cbc' ? 32 : 16;
	const iv = randomBytes(16);
	const aesKey = randomBytes(keyLength);

	const cipher = createCipheriv(cipherName, aesKey, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const cipherPayload = Buffer.concat([iv, ciphertext]);

	let publicKey: KeyObject;
	try {
		publicKey = createPublicKey({ key: spCertificatePem, format: 'pem' });
	} catch {
		throw new SamlAssertionEncryptionError('Invalid SP certificate PEM for assertion encryption');
	}

	const encryptedKey = wrapSymmetricKeyWithTransport(aesKey, publicKey, transport.xmlKeyTransportAlgorithm);

	const encryptedDataId = `_${randomBytes(16).toString('hex')}`;
	const encryptedKeyId = `_${randomBytes(16).toString('hex')}`;

	const cipherValue = cipherPayload.toString('base64');
	const encryptedKeyValue = encryptedKey.toString('base64');

	return `<saml2:EncryptedAssertion xmlns:saml2="${SAML_ASSERTION_NS}">
  <xenc:EncryptedData xmlns:xenc="${XMLENC_NS}" xmlns:ds="${XMLDSIG_NS}" Id="${encryptedDataId}" Type="${XMLENC_ELEMENT_TYPE}">
    <xenc:EncryptionMethod Algorithm="${content.xmlEncryptionMethod}"/>
    <ds:KeyInfo>
      <xenc:EncryptedKey xmlns:xenc11="${XMLENC11_NS}" Id="${encryptedKeyId}">
        <xenc:EncryptionMethod Algorithm="${transport.xmlKeyTransportAlgorithm}"/>
        <xenc:CipherData>
          <xenc:CipherValue>${encryptedKeyValue}</xenc:CipherValue>
        </xenc:CipherData>
      </xenc:EncryptedKey>
    </ds:KeyInfo>
    <xenc:CipherData>
      <xenc:CipherValue>${cipherValue}</xenc:CipherValue>
    </xenc:CipherData>
  </xenc:EncryptedData>
</saml2:EncryptedAssertion>`;
}
