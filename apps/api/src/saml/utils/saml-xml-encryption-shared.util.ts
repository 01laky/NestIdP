import {
	constants,
	createPrivateKey,
	privateDecrypt,
	publicEncrypt,
	type KeyObject,
} from 'node:crypto';

export function wrapSymmetricKeyWithTransport(
	aesKey: Buffer,
	publicKey: KeyObject,
	xmlKeyTransportAlgorithm: string,
): Buffer {
	if (xmlKeyTransportAlgorithm === 'http://www.w3.org/2001/04/xmlenc#rsa-1_5') {
		return publicEncrypt(
			{
				key: publicKey,
				padding: constants.RSA_PKCS1_PADDING,
			},
			aesKey,
		);
	}

	return publicEncrypt(
		{
			key: publicKey,
			padding: constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: 'sha1',
		},
		aesKey,
	);
}

export function unwrapSymmetricKeyWithTransport(
	encryptedKey: Buffer,
	privateKeyPem: string,
	xmlKeyTransportAlgorithm: string,
): Buffer {
	const privateKey = createPrivateKey({ key: privateKeyPem, format: 'pem' });
	if (xmlKeyTransportAlgorithm === 'http://www.w3.org/2001/04/xmlenc#rsa-1_5') {
		return privateDecrypt(
			{
				key: privateKey,
				padding: constants.RSA_PKCS1_PADDING,
			},
			encryptedKey,
		);
	}

	return privateDecrypt(
		{
			key: privateKey,
			padding: constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: 'sha1',
		},
		encryptedKey,
	);
}

export function readBase64CipherValueFromNodes(
	nodes: Node[],
): string {
	const el = nodes[0] as { textContent?: string | null } | undefined;
	const text = el?.textContent?.replace(/\s+/g, '') ?? '';
	if (!text) {
		throw new Error('Malformed EncryptedData: missing CipherValue');
	}
	return text;
}
