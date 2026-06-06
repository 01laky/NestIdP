import { Global, Module } from '@nestjs/common';
import { EncryptionModule } from '../encryption/encryption.module';
import { OAuthTokenService } from './services/oauth-token.service';

/**
 * Provides the OAuth 2.0 Client Credentials token service to both the sync pipeline and the
 * API-connection admin services without creating a module cycle. Global so the in-memory token
 * cache is a single shared instance.
 */
@Global()
@Module({
	imports: [EncryptionModule],
	providers: [OAuthTokenService],
	exports: [OAuthTokenService],
})
export class OAuthCoreModule {}
