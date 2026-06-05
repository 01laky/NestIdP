import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CredentialsEncryptionPort } from '../credentials-encryption.port';
import { decrypt, encrypt } from '../utils/encryption.util';

@Injectable()
export class EncryptionService implements CredentialsEncryptionPort {
	constructor(private readonly configService: ConfigService) {}

	encrypt(plaintext: string): string {
		return encrypt(plaintext, this.getKey());
	}

	decrypt(ciphertext: string): string {
		return decrypt(ciphertext, this.getKey());
	}

	private getKey(): string {
		return this.configService.get<string>('ENCRYPTION_KEY') ?? '';
	}
}
