import { Injectable } from '@nestjs/common';
import { hashPassword, verifyPassword, verifyPasswordTimingSafe } from '../utils/password.util';

@Injectable()
export class PasswordService {
	hash(plaintext: string): Promise<string> {
		return hashPassword(plaintext);
	}

	verify(plaintext: string, hash: string): Promise<boolean> {
		return verifyPassword(plaintext, hash);
	}

	verifyTimingSafe(plaintext: string, hash: string | null): Promise<boolean> {
		return verifyPasswordTimingSafe(plaintext, hash);
	}
}
