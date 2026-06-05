import { createDecipheriv } from 'node:crypto';
import { unwrapSymmetricKeyWithTransport } from '@api/saml/utils/saml-xml-encryption-shared.util';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import {
	getIdpContentEncryptionOption,
	getIdpEncryptionKeyTransportOption,
	IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID,
	IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
} from '@nestidp/shared';

/** Decrypts a `saml2:EncryptedAssertion` produced by `encryptSignedAssertionForSp`. */
export function decryptEncryptedAssertion(
	encryptedAssertionXml: string,
	spPrivateKeyPem: string,
	options: {
		keyTransportAlgorithmId?: string;
		contentEncryptionAlgorithmId?: string;
	} = {},
): string {
	const transportId =
		options.keyTransportAlgorithmId ?? IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID;
	const contentId =
		options.contentEncryptionAlgorithmId ?? IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID;

	const transport = getIdpEncryptionKeyTransportOption(transportId);
	const content = getIdpContentEncryptionOption(contentId);
	if (!transport || !content) {
		throw new Error('Unknown encryption algorithm configuration');
	}

	const doc = new DOMParser().parseFromString(encryptedAssertionXml, 'text/xml');
	const select = xpath.useNamespaces({
		saml2: 'urn:oasis:names:tc:SAML:2.0:assertion',
		xenc: 'http://www.w3.org/2001/04/xmlenc#',
		ds: 'http://www.w3.org/2000/09/xmldsig#',
	});

	const encryptedKeyB64 = readBase64CipherValue(
		select,
		'//xenc:EncryptedData/ds:KeyInfo/xenc:EncryptedKey/xenc:CipherData/xenc:CipherValue',
		doc as unknown as Node,
	);
	const cipherB64 = readBase64CipherValue(
		select,
		'//xenc:EncryptedData/xenc:CipherData/xenc:CipherValue',
		doc as unknown as Node,
	);

	const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
	const cipherPayload = Buffer.from(cipherB64, 'base64');

	const aesKey = unwrapSymmetricKeyWithTransport(
		encryptedKey,
		spPrivateKeyPem,
		transport.xmlKeyTransportAlgorithm,
	);

	const iv = cipherPayload.subarray(0, 16);
	const ciphertext = cipherPayload.subarray(16);
	const cipherName = content.id === 'aes256-cbc' ? 'aes-256-cbc' : 'aes-128-cbc';
	const decipher = createDecipheriv(cipherName, aesKey, iv);
	const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return plaintext.toString('utf8');
}

function readBase64CipherValue(
	select: ReturnType<typeof xpath.useNamespaces>,
	xpathExpr: string,
	doc: Node,
): string {
	const nodes = select(xpathExpr, doc) as Node[];
	const el = nodes[0] as { textContent?: string | null } | undefined;
	const text = el?.textContent?.replace(/\s+/g, '') ?? '';
	if (!text) {
		throw new Error('Malformed EncryptedAssertion');
	}
	return text;
}
