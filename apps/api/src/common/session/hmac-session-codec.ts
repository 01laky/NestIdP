import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless HMAC-signed session token codec (Prompt 38 §6.5 / §A). The `sign` / `verify` / payload-HMAC
 * logic was duplicated almost verbatim between the admin and end-user session services; this is the single
 * source of truth. Each domain keeps its own cookie handling, TTL config and `createPayload` (which differ)
 * and delegates the codec part here.
 *
 * Token format: `base64url(JSON(payload)).base64url(HMAC-SHA256(JSON(payload)))`. The secret is resolved
 * lazily on every call via `getSecret` so a config change is picked up (and so an absent secret is read at
 * use-time, matching the previous behaviour). Verification is constant-time and rejects on bad
 * encoding / signature mismatch / expiry. `TPayload` must carry a Unix-seconds `exp`.
 */
export class HmacSessionCodec<TPayload extends { exp: number }> {
	constructor(private readonly getSecret: () => string) {}

	sign(payload: TPayload): string {
		const payloadJson = JSON.stringify(payload);
		const payloadPart = Buffer.from(payloadJson, 'utf8').toString('base64url');
		return `${payloadPart}.${this.signPayloadJson(payloadJson)}`;
	}

	// §18: `nowSeconds` is injectable so expiry can be tested against a fixed clock.
	verify(token: string | undefined, nowSeconds: number = Math.floor(Date.now() / 1000)): TPayload | null {
		if (!token) {
			return null;
		}
		const dotIndex = token.indexOf('.');
		if (dotIndex <= 0) {
			return null;
		}
		const payloadPart = token.slice(0, dotIndex);
		const signaturePart = token.slice(dotIndex + 1);

		let payloadJson: string;
		try {
			payloadJson = Buffer.from(payloadPart, 'base64url').toString('utf8');
		} catch {
			return null;
		}

		const expectedSignature = this.signPayloadJson(payloadJson);
		const sigA = Buffer.from(signaturePart, 'base64url');
		const sigB = Buffer.from(expectedSignature, 'base64url');
		if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
			return null;
		}

		let payload: TPayload;
		try {
			payload = JSON.parse(payloadJson) as TPayload;
		} catch {
			return null;
		}

		if (payload.exp <= nowSeconds) {
			return null;
		}
		return payload;
	}

	private signPayloadJson(payloadJson: string): string {
		return createHmac('sha256', this.getSecret()).update(payloadJson, 'utf8').digest('base64url');
	}
}
