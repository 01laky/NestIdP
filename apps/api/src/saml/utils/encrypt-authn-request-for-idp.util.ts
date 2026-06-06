import {
	createCipheriv,
	createPrivateKey,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
	randomBytes,
} from 'node:crypto';
import {
	getIdpContentEncryptionOption,
	getIdpEncryptionKeyTransportOption,
	IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID,
	IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID,
} from '@nestidp/shared';
import {
	deriveEcdhEsKeyWithConcatKdf,
	wrapSymmetricKeyWithTransport,
} from './saml-xml-encryption-shared.util';

const XMLENC_NS = 'http://www.w3.org/2001/04/xmlenc#';
const XMLENC11_NS = 'http://www.w3.org/2009/xmlenc11#';
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const XMLENC_ELEMENT_TYPE = 'http://www.w3.org/2001/04/xmlenc#Element';

export interface EncryptAuthnRequestForIdpOptions {
	keyTransportAlgorithmId?: string;
	contentEncryptionAlgorithmId?: string;
}

/** Map from Node.js curve name to OID URI used in xenc11:NamedCurve */
const CURVE_NAME_TO_OID_URI: Record<string, string> = {
	'P-256': 'urn:oid:1.2.840.10045.3.1.7',
	prime256v1: 'urn:oid:1.2.840.10045.3.1.7',
	'P-384': 'urn:oid:1.3.132.0.34',
	secp384r1: 'urn:oid:1.3.132.0.34',
	'P-521': 'urn:oid:1.3.132.0.35',
	secp521r1: 'urn:oid:1.3.132.0.35',
};

/** SPKI header byte lengths for each curve (used to extract the raw point). */
const CURVE_SPKI_HEADER_LENGTH: Record<string, number> = {
	'P-256': 26,
	prime256v1: 26,
	'P-384': 23,
	secp384r1: 23,
	'P-521': 25,
	secp521r1: 25,
};

function detectEcCurveFromCertPem(certPem: string): string | null {
	try {
		const pubKey = createPublicKey({ key: certPem, format: 'pem' });
		if (pubKey.asymmetricKeyType !== 'ec') {
			return null;
		}
		const details = pubKey.asymmetricKeyDetails;
		return (details?.namedCurve ?? null) as string | null;
	} catch {
		return null;
	}
}

/**
 * Builds the AlgorithmID bytes for ConcatKDF.
 * Format: 4-byte BE length prefix + label bytes (e.g. "AES-256" or "AES-128").
 */
function buildConcatKdfAlgorithmId(contentId: string): Buffer {
	const label = contentId === 'aes256-cbc' ? 'AES-256' : 'AES-128';
	const labelBuf = Buffer.from(label, 'utf8');
	const lengthBuf = Buffer.alloc(4);
	lengthBuf.writeUInt32BE(labelBuf.length, 0);
	return Buffer.concat([lengthBuf, labelBuf]);
}

export function encryptAuthnRequestForIdp(
	plainAuthnRequestXml: string,
	idpEncryptionCertPem: string,
	options: EncryptAuthnRequestForIdpOptions = {},
): string {
	// Detect key type
	const ecCurve = detectEcCurveFromCertPem(idpEncryptionCertPem);
	if (ecCurve) {
		return encryptAuthnRequestForIdpEc(
			plainAuthnRequestXml,
			idpEncryptionCertPem,
			ecCurve,
			options,
		);
	}
	return encryptAuthnRequestForIdpRsa(plainAuthnRequestXml, idpEncryptionCertPem, options);
}

function encryptAuthnRequestForIdpRsa(
	plainAuthnRequestXml: string,
	idpEncryptionCertPem: string,
	options: EncryptAuthnRequestForIdpOptions,
): string {
	const transportId =
		options.keyTransportAlgorithmId ?? IDP_ENCRYPTION_DEFAULT_KEY_TRANSPORT_ALGORITHM_ID;
	const contentId =
		options.contentEncryptionAlgorithmId ?? IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID;
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
	const encryptedKey = wrapSymmetricKeyWithTransport(
		aesKey,
		publicKey,
		transport.xmlKeyTransportAlgorithm,
	);

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

function encryptAuthnRequestForIdpEc(
	plainAuthnRequestXml: string,
	idpEncryptionCertPem: string,
	ecCurve: string,
	options: EncryptAuthnRequestForIdpOptions,
): string {
	const contentId =
		options.contentEncryptionAlgorithmId ?? IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID;
	const content = getIdpContentEncryptionOption(contentId)!;

	const namedCurveOidUri = CURVE_NAME_TO_OID_URI[ecCurve];
	if (!namedCurveOidUri) {
		throw new Error(`Unsupported EC curve: ${ecCurve}`);
	}
	const spkiHeaderLen = CURVE_SPKI_HEADER_LENGTH[ecCurve] ?? 26;

	// Generate ephemeral EC key pair on same curve
	const ephemeral = generateKeyPairSync('ec', {
		namedCurve: ecCurve,
		publicKeyEncoding: { type: 'spki', format: 'der' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
	const ephemeralPubKeyDer = ephemeral.publicKey as unknown as Buffer;
	// Extract uncompressed point (skip SPKI header)
	const ephemeralPoint = ephemeralPubKeyDer.subarray(spkiHeaderLen);
	const ephemeralPointB64 = ephemeralPoint.toString('base64');

	// Get IdP public key from cert
	const idpPubKey = createPublicKey({ key: idpEncryptionCertPem, format: 'pem' });
	// Get ephemeral private key
	const ephemeralPrivKey = createPrivateKey({ key: ephemeral.privateKey, format: 'pem' });

	// ECDH shared secret
	const sharedSecret = diffieHellman({ privateKey: ephemeralPrivKey, publicKey: idpPubKey });

	// Build AlgorithmID for ConcatKDF
	const algorithmIdBuf = buildConcatKdfAlgorithmId(content.id);
	const algorithmIdHex = algorithmIdBuf.toString('hex').match(/../g)!.join(' ');

	// Derive AES key
	const keyLengthBits: 128 | 256 = content.id === 'aes256-cbc' ? 256 : 128;
	const aesKey = deriveEcdhEsKeyWithConcatKdf({
		sharedSecret,
		algorithmId: algorithmIdBuf,
		keyLengthBits,
	});

	// Encrypt content
	const plaintext = plainAuthnRequestXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
	const cipherName = content.id === 'aes256-cbc' ? 'aes-256-cbc' : 'aes-128-cbc';
	const keyLength = content.id === 'aes256-cbc' ? 32 : 16;
	const iv = randomBytes(16);
	const cipher = createCipheriv(cipherName, aesKey.subarray(0, keyLength), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const cipherPayload = Buffer.concat([iv, ciphertext]);

	const encryptedDataId = `_${randomBytes(16).toString('hex')}`;

	return `<xenc:EncryptedData xmlns:xenc="${XMLENC_NS}" xmlns:xenc11="${XMLENC11_NS}" xmlns:ds="${XMLDSIG_NS}" Id="${encryptedDataId}" Type="${XMLENC_ELEMENT_TYPE}">
  <xenc:EncryptionMethod Algorithm="${content.xmlEncryptionMethod}"/>
  <ds:KeyInfo>
    <xenc11:AgreementMethod Algorithm="http://www.w3.org/2009/xmlenc11#ECDH-ES">
      <xenc11:KeyDerivationMethod Algorithm="http://www.w3.org/2009/xmlenc11#ConcatKDF">
        <xenc11:ConcatKDFParams AlgorithmID="${algorithmIdHex}" PartyUInfo="" PartyVInfo=""/>
      </xenc11:KeyDerivationMethod>
      <xenc11:OriginatorKeyInfo>
        <ds:KeyValue>
          <xenc11:ECKeyValue>
            <xenc11:NamedCurve URI="${namedCurveOidUri}"/>
            <xenc11:PublicKey>${ephemeralPointB64}</xenc11:PublicKey>
          </xenc11:ECKeyValue>
        </ds:KeyValue>
      </xenc11:OriginatorKeyInfo>
    </xenc11:AgreementMethod>
  </ds:KeyInfo>
  <xenc:CipherData>
    <xenc:CipherValue>${cipherPayload.toString('base64')}</xenc:CipherValue>
  </xenc:CipherData>
</xenc:EncryptedData>`;
}
