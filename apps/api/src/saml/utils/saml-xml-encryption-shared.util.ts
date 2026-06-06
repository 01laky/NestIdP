import {
	constants,
	createHash,
	createPrivateKey,
	createPublicKey,
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

/**
 * ConcatKDF per NIST SP 800-56A §5.8.1 (single SHA-256 round).
 * Used for ECDH-ES key derivation in XML Encryption 1.1.
 */
export function deriveEcdhEsKeyWithConcatKdf(options: {
	sharedSecret: Buffer;
	algorithmId: Buffer;
	partyUInfo?: Buffer;
	partyVInfo?: Buffer;
	keyLengthBits: 128 | 256;
}): Buffer {
	const {
		sharedSecret,
		algorithmId,
		partyUInfo = Buffer.alloc(0),
		partyVInfo = Buffer.alloc(0),
		keyLengthBits,
	} = options;

	function lenBE4(buf: Buffer): Buffer {
		const b = Buffer.alloc(4);
		b.writeUInt32BE(buf.length, 0);
		return b;
	}

	const counterBuf = Buffer.alloc(4);
	counterBuf.writeUInt32BE(1, 0);

	const keyDataLenBuf = Buffer.alloc(4);
	keyDataLenBuf.writeUInt32BE(keyLengthBits, 0);

	const hashInput = Buffer.concat([
		counterBuf,
		sharedSecret,
		lenBE4(algorithmId),
		algorithmId,
		lenBE4(partyUInfo),
		partyUInfo,
		lenBE4(partyVInfo),
		partyVInfo,
		keyDataLenBuf,
	]);

	const digest = createHash('sha256').update(hashInput).digest();
	return digest.subarray(0, keyLengthBits / 8);
}

function getSpkiHeaderForCurveOid(oid: string): Buffer {
	// P-256 (prime256v1): OID 1.2.840.10045.3.1.7 — 26-byte header
	if (oid === '1.2.840.10045.3.1.7') {
		return Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
	}
	// P-384 (secp384r1): OID 1.3.132.0.34 — 23-byte header
	if (oid === '1.3.132.0.34') {
		return Buffer.from('3076301006072a8648ce3d020106052b81040022036200', 'hex');
	}
	// P-521 (secp521r1): OID 1.3.132.0.35 — 25-byte header
	if (oid === '1.3.132.0.35') {
		return Buffer.from('30819b301006072a8648ce3d020106052b8104002303818600', 'hex');
	}
	throw new Error(`Unsupported EC curve OID: ${oid}`);
}

/**
 * Parses an uncompressed EC point from xenc11:PublicKey base64 + curve OID
 * into a Node.js KeyObject (SubjectPublicKeyInfo DER wrapping).
 */
export function extractEcPublicKeyFromXenc11(curveOid: string, publicKeyBase64: string): KeyObject {
	const point = Buffer.from(publicKeyBase64.replace(/\s+/g, ''), 'base64');
	if (point[0] !== 0x04) {
		throw new Error('EC public key must be in uncompressed form (0x04 prefix)');
	}
	const spkiHeader = getSpkiHeaderForCurveOid(curveOid);
	const spki = Buffer.concat([spkiHeader, point]);
	return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

export function readBase64CipherValueFromNodes(nodes: Node[]): string {
	const el = nodes[0] as { textContent?: string | null } | undefined;
	const text = el?.textContent?.replace(/\s+/g, '') ?? '';
	if (!text) {
		throw new Error('Malformed EncryptedData: missing CipherValue');
	}
	return text;
}
