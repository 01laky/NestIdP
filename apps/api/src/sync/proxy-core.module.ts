import { Global, Module } from '@nestjs/common';
import { EncryptionModule } from '../encryption/encryption.module';
import { ProxyDispatcherService } from './services/proxy-dispatcher.service';

/**
 * Provides the per-connection outbound-proxy dispatcher factory (Prompt 33) to both the sync pipeline
 * and the API-connection admin/test services without a module cycle. Global so the `ProxyAgent` pool is
 * a single shared instance (one agent per connection, reused across sync/OAuth/test calls and closed
 * cleanly on config change, delete, and shutdown). Mirrors {@link OAuthCoreModule}.
 */
@Global()
@Module({
	imports: [EncryptionModule],
	providers: [ProxyDispatcherService],
	exports: [ProxyDispatcherService],
})
export class ProxyCoreModule {}
