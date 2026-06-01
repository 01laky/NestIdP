export interface CredentialsEncryptionPort {
	encrypt(plaintext: string): string;
	decrypt(ciphertext: string): string;
}

export const CREDENTIALS_ENCRYPTION = Symbol('CREDENTIALS_ENCRYPTION');
