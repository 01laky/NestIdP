import { createDecipheriv, createPrivateKey, diffieHellman } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import {
	getIdpContentEncryptionOption,
	getIdpEncryptionKeyTransportOption,
	IDP_CONTENT_ENCRYPTION_ALGORITHMS,
	IDP_ENCRYPTION_KEY_TRANSPORT_ALGORITHMS,
} from '@nestidp/shared';
import {
	deriveEcdhEsKeyWithConcatKdf,
	extractEcPublicKeyFromXenc11,
	readBase64CipherValueFromNodes,
	unwrapSymmetricKeyWithTransport,
} from './saml-xml-encryption-shared.util';

const XENC11_NS = 'http://www.w3.org/2009/xmlenc11#';
const ECDH_ES_URI = 'http://www.w3.org/2009/xmlenc11#ECDH-ES';
const AES_GCM_URIS = new Set([
	'http://www.w3.org/2009/xmlenc11#aes256-gcm',
	'http://www.w3.org/2009/xmlenc11#aes128-gcm',
	'http://www.w3.org/2001/04/xmlenc#aes256-gcm',
	'http://www.w3.org/2001/04/xmlenc#aes128-gcm',
]);

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
			: readAlgorithmUri(
					select,
					'//xenc:EncryptedData/xenc:EncryptionMethod/@Algorithm',
					doc as unknown as Node,
				);

	const transportUri =
		options.keyTransportAlgorithmId !== undefined
			? getIdpEncryptionKeyTransportOption(options.keyTransportAlgorithmId)
					?.xmlKeyTransportAlgorithm
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
		select(
			'//xenc:EncryptedData/xenc:CipherData/xenc:CipherValue',
			doc as unknown as Node,
		) as Node[],
	);

	const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
	const cipherPayload = Buffer.from(cipherB64, 'base64');

	let aesKey: Buffer;
	try {
		aesKey = unwrapSymmetricKeyWithTransport(
			encryptedKey,
			privateKeyPem,
			transport.xmlKeyTransportAlgorithm,
		);
	} catch {
		throw new SamlXmlDecryptionError(
			'Failed to unwrap encrypted symmetric key',
			'decrypt_key_unwrap_failed',
		);
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
		throw new SamlXmlDecryptionError(
			'Missing EncryptionMethod Algorithm URI',
			'missing_algorithm_uri',
		);
	}
	return uri;
}

function resolveContentOption(uri: string | undefined) {
	if (!uri) {
		throw new SamlXmlDecryptionError(
			'Missing content encryption algorithm',
			'encrypted_request_unsupported_algorithm',
		);
	}
	const option = IDP_CONTENT_ENCRYPTION_ALGORITHMS.find(
		(entry) => entry.xmlEncryptionMethod === uri,
	);
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
		throw new SamlXmlDecryptionError(
			'Missing key transport algorithm',
			'encrypted_request_unsupported_algorithm',
		);
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

/** Map from NamedCurve OID to expected uncompressed point size (for validation). */
const CURVE_OID_TO_POINT_BYTE_SIZE: Record<string, number> = {
	'1.2.840.10045.3.1.7': 65, // P-256
	'1.3.132.0.34': 97, // P-384
	'1.3.132.0.35': 133, // P-521
};

/** Map from NamedCurve OID to Node.js curve name. */
const CURVE_OID_TO_NAME: Record<string, string> = {
	'1.2.840.10045.3.1.7': 'P-256',
	'1.3.132.0.34': 'P-384',
	'1.3.132.0.35': 'P-521',
};

/**
 * Returns true if the encrypted XML uses xenc11:AgreementMethod (ECDH-ES path).
 */
export function isEcdhEsAgreement(xml: string): boolean {
	try {
		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		const select = xpath.useNamespaces({
			xenc: 'http://www.w3.org/2001/04/xmlenc#',
			ds: 'http://www.w3.org/2000/09/xmldsig#',
			xenc11: XENC11_NS,
		});
		const nodes = select(
			'//xenc:EncryptedData/ds:KeyInfo/xenc11:AgreementMethod',
			doc as unknown as Node,
		) as Node[];
		return nodes.length > 0;
	} catch {
		return false;
	}
}

/**
 * Decrypt an ECDH-ES (XML Encryption 1.1) encrypted payload.
 */
export function decryptXmlEcdhEs(
	encryptedXml: string,
	privateKeyPem: string,
	ecCurve: string,
): string {
	const doc = new DOMParser().parseFromString(encryptedXml, 'text/xml');
	const select = xpath.useNamespaces({
		xenc: 'http://www.w3.org/2001/04/xmlenc#',
		ds: 'http://www.w3.org/2000/09/xmldsig#',
		xenc11: XENC11_NS,
	});

	// 1. Validate AgreementMethod algorithm
	const agreementMethodNodes = select(
		'//xenc:EncryptedData/ds:KeyInfo/xenc11:AgreementMethod',
		doc as unknown as Node,
	) as Element[];
	if (!agreementMethodNodes.length) {
		throw new SamlXmlDecryptionError(
			'Missing xenc11:AgreementMethod element',
			'ec_agreement_method_not_supported',
		);
	}
	const agreementMethodUri = agreementMethodNodes[0].getAttribute('Algorithm') ?? '';
	if (agreementMethodUri !== ECDH_ES_URI) {
		throw new SamlXmlDecryptionError(
			`Unsupported AgreementMethod: ${agreementMethodUri}`,
			'ec_agreement_method_not_supported',
		);
	}

	// 2. Extract content encryption algorithm
	const contentUriNodes = select(
		'//xenc:EncryptedData/xenc:EncryptionMethod/@Algorithm',
		doc as unknown as Node,
	) as Attr[];
	const contentUri = contentUriNodes[0]?.value?.trim();
	if (!contentUri) {
		throw new SamlXmlDecryptionError(
			'Missing content EncryptionMethod Algorithm',
			'missing_algorithm_uri',
		);
	}
	if (AES_GCM_URIS.has(contentUri)) {
		throw new SamlXmlDecryptionError(
			`AES-GCM content encryption is not supported: ${contentUri}`,
			'encrypted_request_unsupported_algorithm',
		);
	}
	const contentOption = IDP_CONTENT_ENCRYPTION_ALGORITHMS.find(
		(e) => e.xmlEncryptionMethod === contentUri,
	);
	if (!contentOption) {
		throw new SamlXmlDecryptionError(
			`Unsupported content encryption algorithm: ${contentUri}`,
			'encrypted_request_unsupported_algorithm',
		);
	}
	const keyLengthBits: 128 | 256 = contentOption.id === 'aes256-cbc' ? 256 : 128;

	// 3. Extract ephemeral public key from OriginatorKeyInfo
	const namedCurveNodes = select(
		'//xenc:EncryptedData/ds:KeyInfo/xenc11:AgreementMethod/xenc11:OriginatorKeyInfo/ds:KeyValue/xenc11:ECKeyValue/xenc11:NamedCurve/@URI',
		doc as unknown as Node,
	) as Attr[];
	const pubKeyNodes = select(
		'//xenc:EncryptedData/ds:KeyInfo/xenc11:AgreementMethod/xenc11:OriginatorKeyInfo/ds:KeyValue/xenc11:ECKeyValue/xenc11:PublicKey',
		doc as unknown as Node,
	) as Element[];

	const namedCurveUri = namedCurveNodes[0]?.value?.trim() ?? '';
	const pubKeyText = (pubKeyNodes[0]?.textContent ?? '').replace(/\s+/g, '');

	if (!namedCurveUri || !pubKeyText) {
		throw new SamlXmlDecryptionError(
			'Missing ephemeral EC key in OriginatorKeyInfo',
			'ec_point_invalid',
		);
	}

	// Convert urn:oid:<oid> to <oid>
	const oid = namedCurveUri.startsWith('urn:oid:')
		? namedCurveUri.slice('urn:oid:'.length)
		: namedCurveUri;

	const expectedCurveName = CURVE_OID_TO_NAME[oid];
	if (!expectedCurveName) {
		throw new SamlXmlDecryptionError(`Unsupported EC curve OID: ${oid}`, 'ec_curve_mismatch');
	}
	if (expectedCurveName !== ecCurve) {
		throw new SamlXmlDecryptionError(
			`EC curve mismatch: payload uses ${expectedCurveName}, IdP key is ${ecCurve}`,
			'ec_curve_mismatch',
		);
	}

	// 4. Parse ephemeral public key
	let ephemeralPublicKey;
	try {
		const point = Buffer.from(pubKeyText, 'base64');
		const expectedSize = CURVE_OID_TO_POINT_BYTE_SIZE[oid];
		if (!expectedSize || point.length !== expectedSize || point[0] !== 0x04) {
			throw new Error('Invalid point size or format');
		}
		ephemeralPublicKey = extractEcPublicKeyFromXenc11(oid, pubKeyText);
	} catch (err) {
		throw new SamlXmlDecryptionError(
			`Failed to parse ephemeral EC public key: ${err instanceof Error ? err.message : String(err)}`,
			'ec_point_invalid',
		);
	}

	// 5. ECDH: compute shared secret
	let sharedSecret: Buffer;
	try {
		const idpPrivKey = createPrivateKey({ key: privateKeyPem, format: 'pem' });
		sharedSecret = diffieHellman({ privateKey: idpPrivKey, publicKey: ephemeralPublicKey });
	} catch (err) {
		throw new SamlXmlDecryptionError(
			`ECDH computation failed: ${err instanceof Error ? err.message : String(err)}`,
			'ecdh_compute_failed',
		);
	}

	// 6. ConcatKDF: derive AES key
	const algorithmIdHexNodes = select(
		'//xenc:EncryptedData/ds:KeyInfo/xenc11:AgreementMethod/xenc11:KeyDerivationMethod/xenc11:ConcatKDFParams/@AlgorithmID',
		doc as unknown as Node,
	) as Attr[];
	const algorithmIdHex = (algorithmIdHexNodes[0]?.value ?? '').replace(/\s+/g, '');
	let algorithmIdBuf: Buffer;
	try {
		algorithmIdBuf = algorithmIdHex ? Buffer.from(algorithmIdHex, 'hex') : Buffer.alloc(0);
	} catch {
		algorithmIdBuf = Buffer.alloc(0);
	}

	const partyUInfoHexNodes = select(
		'//xenc:EncryptedData/ds:KeyInfo/xenc11:AgreementMethod/xenc11:KeyDerivationMethod/xenc11:ConcatKDFParams/@PartyUInfo',
		doc as unknown as Node,
	) as Attr[];
	const partyVInfoHexNodes = select(
		'//xenc:EncryptedData/ds:KeyInfo/xenc11:AgreementMethod/xenc11:KeyDerivationMethod/xenc11:ConcatKDFParams/@PartyVInfo',
		doc as unknown as Node,
	) as Attr[];
	const partyUInfoHex = (partyUInfoHexNodes[0]?.value ?? '').replace(/\s+/g, '');
	const partyVInfoHex = (partyVInfoHexNodes[0]?.value ?? '').replace(/\s+/g, '');
	const partyUInfo = partyUInfoHex ? Buffer.from(partyUInfoHex, 'hex') : Buffer.alloc(0);
	const partyVInfo = partyVInfoHex ? Buffer.from(partyVInfoHex, 'hex') : Buffer.alloc(0);

	let aesKey: Buffer;
	try {
		aesKey = deriveEcdhEsKeyWithConcatKdf({
			sharedSecret,
			algorithmId: algorithmIdBuf,
			partyUInfo,
			partyVInfo,
			keyLengthBits,
		});
	} catch (err) {
		throw new SamlXmlDecryptionError(
			`ConcatKDF derivation failed: ${err instanceof Error ? err.message : String(err)}`,
			'concatkdf_failed',
		);
	}

	// 7. Decrypt content
	const cipherB64 = readBase64CipherValueFromNodes(
		select(
			'//xenc:EncryptedData/xenc:CipherData/xenc:CipherValue',
			doc as unknown as Node,
		) as Node[],
	);
	const cipherPayload = Buffer.from(cipherB64, 'base64');
	const iv = cipherPayload.subarray(0, 16);
	const ciphertext = cipherPayload.subarray(16);
	const cipherName = contentOption.id === 'aes256-cbc' ? 'aes-256-cbc' : 'aes-128-cbc';

	try {
		const decipher = createDecipheriv(cipherName, aesKey, iv);
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		return plaintext.toString('utf8');
	} catch {
		throw new SamlXmlDecryptionError('Failed to decrypt XML ciphertext', 'decrypt_content_failed');
	}
}

export function isEncryptedDataRoot(xml: string): boolean {
	try {
		const doc = new DOMParser().parseFromString(xml, 'text/xml');
		const root = doc.documentElement;
		if (!root) {
			return false;
		}
		return (
			root.localName === 'EncryptedData' &&
			root.namespaceURI === 'http://www.w3.org/2001/04/xmlenc#'
		);
	} catch {
		return false;
	}
}
