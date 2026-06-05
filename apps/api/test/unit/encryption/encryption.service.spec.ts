import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '@api/encryption/services/encryption.service';

describe('EncryptionService', () => {
	const config = {
		get: jest.fn((key: string) =>
			key === 'ENCRYPTION_KEY' ? 'test-encryption-key-32chars!!' : undefined,
		),
	} as unknown as ConfigService;

	const service = new EncryptionService(config);

	it('API-ENC-SVC-01: encrypt/decrypt round-trip via ConfigService key', () => {
		const ciphertext = service.encrypt('service-layer-token');
		expect(ciphertext.startsWith('v1:')).toBe(true);
		expect(service.decrypt(ciphertext)).toBe('service-layer-token');
	});

	it('API-ENC-SVC-02: wrong key after encrypt throws on decrypt', () => {
		const ciphertext = service.encrypt('token');
		const other = new EncryptionService({
			get: () => 'other-encryption-key-32chars!',
		} as unknown as ConfigService);
		expect(() => other.decrypt(ciphertext)).toThrow();
	});

	it('API-ENC-SVC-03: implements CredentialsEncryptionPort contract', () => {
		expect(typeof service.encrypt).toBe('function');
		expect(typeof service.decrypt).toBe('function');
	});
});
