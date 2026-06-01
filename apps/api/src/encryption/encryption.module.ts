import { Global, Module } from '@nestjs/common';
import { CREDENTIALS_ENCRYPTION } from './credentials-encryption.port';
import { EncryptionService } from './encryption.service';

@Global()
@Module({
	providers: [
		EncryptionService,
		{
			provide: CREDENTIALS_ENCRYPTION,
			useExisting: EncryptionService,
		},
	],
	exports: [EncryptionService, CREDENTIALS_ENCRYPTION],
})
export class EncryptionModule {}
