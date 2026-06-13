import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { boundedInt as boundedIntFromRaw } from '../common/config/bounded-int.util';

export const DEFAULT_SP_METADATA_FETCH_TIMEOUT_MS = 5_000;
export const DEFAULT_SP_METADATA_FETCH_MAX_BYTES = 262_144;
export const DEFAULT_SP_METADATA_FETCH_MAX_REDIRECTS = 3;

/**
 * Bounded env config for server-side SP-metadata-by-URL fetching (Prompt 42). Mirrors the bounded-int
 * style of the other config services. Keeps the metadata importer from being a request-amplification or
 * memory-exhaustion vector (timeout + size cap + redirect cap).
 */
@Injectable()
export class SpMetadataFetchConfig {
	constructor(private readonly configService: ConfigService) {}

	timeoutMs(): number {
		return this.boundedInt(
			'SP_METADATA_FETCH_TIMEOUT_MS',
			DEFAULT_SP_METADATA_FETCH_TIMEOUT_MS,
			1_000,
			60_000,
		);
	}

	maxBytes(): number {
		return this.boundedInt(
			'SP_METADATA_FETCH_MAX_BYTES',
			DEFAULT_SP_METADATA_FETCH_MAX_BYTES,
			1_024,
			5_242_880,
		);
	}

	maxRedirects(): number {
		return this.boundedInt(
			'SP_METADATA_FETCH_MAX_REDIRECTS',
			DEFAULT_SP_METADATA_FETCH_MAX_REDIRECTS,
			0,
			10,
		);
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		return boundedIntFromRaw(this.configService.get<number | string>(key), fallback, min, max);
	}
}
