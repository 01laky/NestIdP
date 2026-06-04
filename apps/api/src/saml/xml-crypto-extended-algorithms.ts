import * as crypto from 'node:crypto';
import type { SignedXml } from 'xml-crypto';

/** xml-crypto 6.x ships RSA-SHA1/256/512 only; NestIdP registers RSA-SHA384 and ECDSA variants. */

type SigCtor = new () => {
	getSignature(signedInfo: string, privateKey: crypto.KeyLike): string;
	verifySignature(material: string, key: crypto.KeyLike, signatureValue: string): boolean;
	getAlgorithmName(): string;
};

function makeRsaSignature(nodeAlgorithm: 'RSA-SHA384', xmlUri: string): SigCtor {
	return class {
		getSignature(signedInfo: string, privateKey: crypto.KeyLike): string {
			const signer = crypto.createSign(nodeAlgorithm);
			signer.update(signedInfo);
			return signer.sign(privateKey, 'base64');
		}
		verifySignature(material: string, key: crypto.KeyLike, signatureValue: string): boolean {
			const verifier = crypto.createVerify(nodeAlgorithm);
			verifier.update(material);
			return verifier.verify(key, signatureValue, 'base64');
		}
		getAlgorithmName(): string {
			return xmlUri;
		}
	};
}

function makeEcdsaSignature(
	nodeAlgorithm: 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512',
	xmlUri: string,
): SigCtor {
	return class {
		getSignature(signedInfo: string, privateKey: crypto.KeyLike): string {
			const signer = crypto.createSign(nodeAlgorithm);
			signer.update(signedInfo);
			return signer.sign(privateKey, 'base64');
		}
		verifySignature(material: string, key: crypto.KeyLike, signatureValue: string): boolean {
			const verifier = crypto.createVerify(nodeAlgorithm);
			verifier.update(material);
			return verifier.verify(key, signatureValue, 'base64');
		}
		getAlgorithmName(): string {
			return xmlUri;
		}
	};
}

class Sha384 {
	getHash(xml: string): string {
		return crypto.createHash('sha384').update(xml, 'utf8').digest('base64');
	}
	getAlgorithmName(): string {
		return 'http://www.w3.org/2001/04/xmlenc#sha384';
	}
}

const RsaSha384 = makeRsaSignature(
	'RSA-SHA384',
	'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384',
);
const EcdsaSha1 = makeEcdsaSignature('SHA1', 'http://www.w3.org/2000/09/xmldsig#ecdsa-sha1');
const EcdsaSha256 = makeEcdsaSignature(
	'SHA256',
	'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
);
const EcdsaSha384 = makeEcdsaSignature(
	'SHA384',
	'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384',
);
const EcdsaSha512 = makeEcdsaSignature(
	'SHA512',
	'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512',
);

export function applyNestIdpXmlCryptoExtensions(sig: SignedXml): void {
	sig.HashAlgorithms['http://www.w3.org/2001/04/xmlenc#sha384'] = Sha384;
	sig.SignatureAlgorithms['http://www.w3.org/2001/04/xmldsig-more#rsa-sha384'] = RsaSha384;
	sig.SignatureAlgorithms['http://www.w3.org/2000/09/xmldsig#ecdsa-sha1'] = EcdsaSha1;
	sig.SignatureAlgorithms['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'] = EcdsaSha256;
	sig.SignatureAlgorithms['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384'] = EcdsaSha384;
	sig.SignatureAlgorithms['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512'] = EcdsaSha512;
}
