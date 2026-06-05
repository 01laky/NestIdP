import { createDecipheriv } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import {
	getIdpContentEncryptionOption,
	getIdpEncryptionKeyTransportOption,
	IDP_CONTENT_ENCRYPTION_ALGORITHMS,
	IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS,
} from '@nestidp/shared';
import {
	readBase64CipherValueFromNodes,
	unwrapSymmetricKeyWithTransport,
} from './saml-xml-encryption-shared.util';

export class SamlXmlDecryptionError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = 'SamlXmlDecryptionError';
	}
}

export interface DecryptXmlEncryptedElementOptions {
	keyTransportAlgorithmId?: string;
	contentEncryptionAlgorithmId?: string;
}

export function decryptXmlEncryptedElement(
	encryptedXml: string,
	privateKeyPem: string,
	options: DecryptXmlEncryptedElementOptions = {},
): string {
	const doc = new DOMParser().parseFromString(encryptedXml, 'text/xml');
	const select = xpath.useNamespaces({
		xenc: 'http://www.w3.org/2001/04/xmlenc#',
		ds: 'http://www.w3.org/2000/09/xmldsig#',
	});

	const contentUri =
		options.contentEncryptionAlgorithmId !== undefined
			? getIdpContentEncryptionOption(options.contentEncryptionAlgorithmId)?.xmlEncryptionMethod
			: readAlgorithmUri(select, '//xenc:EncryptedData/xenc:EncryptionMethod/@Algorithm', doc as unknown as Node);

	const transportUri =
		options.keyTransportAlgorithmId !== undefined
			? getIdpEncryptionKeyTransportOption(options.keyTransportAlgorithmId)?.xmlKeyTransportAlgorithm
			: readAlgorithmUri(
					select,
					'//xenc:EncryptedData/ds:KeyInfo/xenc:EncryptedKey/xenc:EncryptionMethod/@Algorithm',
					doc as unknown as Node,
				);

	const content = resolveContentOption(contentUri);
	const transport = resolveTransportOption(transportUri);

	const encryptedKeyB64 = readBase64CipherValueFromNodes(
		select(
			'//xenc:EncryptedData/ds:KeyInfo/xenc:EncryptedKey/xenc:CipherData/xenc:CipherValue',
			doc as unknown as Node,
		) as Node[],
	);
	const cipherB64 = readBase64CipherValueFromNodes(
		select('//xenc:EncryptedData/xenc:CipherData/xenc:CipherValue', doc as unknown as Node) as Node[],
	);

	const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
	const cipherPayload = Buffer.from(cipherB64, 'base64');

	let aesKey: Buffer;
	try {
		aesKey = unwrapSymmetricKeyWithTransport(encryptedKey, privateKeyPem, transport.xmlKeyTransportAlgorithm);
	} catch {
		throw new SamlXmlDecryptionError('Failed to unwrap encrypted symmetric key', 'decrypt_key_unwrap_failed');
	}

	const iv = cipherPayload.subarray(0, 16);
	const ciphertext = cipherPayload.subarray(16);
	const cipherName = content.id === 'aes256-cbc' ? 'aes-256-cbc' : 'aes-128-cbc';
	try {
		const decipher = createDecipheriv(cipherName, aesKey, iv);
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		return plaintext.toString('utf8');
	} catch {
		throw new SamlXmlDecryptionError('Failed to decrypt XML ciphertext', 'decrypt_content_failed');
	}
}

function readAlgorithmUri(
	select: ReturnType<typeof xpath.useNamespaces>,
	expr: string,
	doc: Node,
): string {
	const nodes = select(expr, doc) as Attr[];
	const uri = nodes[0]?.value?.trim();
	if (!uri) {
		throw new SamlXmlDecryptionError('Missing EncryptionMethod Algorithm URI', 'missing_algorithm_uri');
	}
	return uri;
}

function resolveContentOption(uri: string | undefined) {
	if (!uri) {
		throw new SamlXmlDecryptionError('Missing content encryption algorithm', 'encrypted_request_unsupported_algorithm');
	}
	const option = IDP_CONTENT_ENCRYPTION_ALGORITHMS.find((entry) => entry.xmlEncryptionMethod === uri);
	if (!option) {
		throw new SamlXmlDecryptionError(
			`Unsupported content encryption: ${uri}`,
			'encrypted_request_unsupported_algorithm',
		);
	}
	return option;
}

function resolveTransportOption(uri: string | undefined) {
	if (!uri) {
		throw new SamlXmlDecryptionError('Missing key transport algorithm', 'encrypted_request_unsupported_algorithm');
	}
	const option = IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS.find(
		(entry) => entry.xmlKeyTransportAlgorithm === uri,
	);
	if (!option) {
		throw new SamlXmlDecryptionError(
			`Unsupported key transport: ${uri}`,
			'encrypted_request_unsupported_algorithm',
		);
	}
	return option;
}

export function isEncryptedDataRoot(xml: string): boolean {
	try {
		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		const root = doc.documentElement;
		if (!root) {
			return false;
		}
		return root.localName === 'EncryptedData' && root.namespaceURI === 'http://www.w3.org/2001/04/xmlenc#';
	} catch {
		return false;
	}
}
