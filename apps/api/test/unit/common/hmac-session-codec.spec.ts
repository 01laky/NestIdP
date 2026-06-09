import { HmacSessionCodec } from '@api/common/session/hmac-session-codec';

interface TestPayload {
	userId: string;
	exp: number;
}

const SECRET = 'test-session-secret-min-16';
const futureExp = () => Math.floor(Date.now() / 1000) + 3600;

describe('HmacSessionCodec (§6.5)', () => {
	const codec = new HmacSessionCodec<TestPayload>(() => SECRET);

	it('HMAC-CODEC-01: round-trips a valid payload', () => {
		const payload = { userId: 'u1', exp: futureExp() };
		expect(codec.verify(codec.sign(payload))).toEqual(payload);
	});

	it('HMAC-CODEC-02: rejects a tampered signature', () => {
		const token = codec.sign({ userId: 'u1', exp: futureExp() });
		const tampered = `${token.slice(0, -2)}xx`;
		expect(codec.verify(tampered)).toBeNull();
	});

	it('HMAC-CODEC-03: rejects a token signed with a different secret', () => {
		const other = new HmacSessionCodec<TestPayload>(() => 'different-secret-16-chars');
		const token = other.sign({ userId: 'u1', exp: futureExp() });
		expect(codec.verify(token)).toBeNull();
	});

	it('HMAC-CODEC-04: rejects an expired payload', () => {
		const token = codec.sign({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 1 });
		expect(codec.verify(token)).toBeNull();
	});

	it('HMAC-CODEC-05: rejects undefined / malformed tokens', () => {
		expect(codec.verify(undefined)).toBeNull();
		expect(codec.verify('')).toBeNull();
		expect(codec.verify('no-dot-here')).toBeNull();
		expect(codec.verify('.signatureonly')).toBeNull();
	});

	it('HMAC-CODEC-06: the secret is resolved lazily on each call', () => {
		let secret = 'first-secret-16-chars';
		const lazy = new HmacSessionCodec<TestPayload>(() => secret);
		const token = lazy.sign({ userId: 'u1', exp: futureExp() });
		// rotating the secret invalidates previously-signed tokens
		secret = 'rotated-secret-16-chars';
		expect(lazy.verify(token)).toBeNull();
	});

	it('HMAC-CODEC-07: expiry boundary — exp === now is rejected, exp strictly in the future is accepted', () => {
		const now = Math.floor(Date.now() / 1000);
		// exp === now: `exp <= now` holds now and only more so as the clock advances → always rejected.
		expect(codec.verify(codec.sign({ userId: 'u1', exp: now }))).toBeNull();
		// well into the future → accepted.
		expect(codec.verify(codec.sign({ userId: 'u1', exp: now + 3600 }))).not.toBeNull();
	});

	it('HMAC-CODEC-08: tampering with the PAYLOAD (re-encoded, old signature) is rejected', () => {
		const token = codec.sign({ userId: 'u1', exp: futureExp() });
		const sigPart = token.slice(token.indexOf('.') + 1);
		// Forge a privilege escalation: swap the payload but keep the original signature.
		const forgedPayload = Buffer.from(
			JSON.stringify({ userId: 'admin', exp: futureExp() }),
			'utf8',
		).toString('base64url');
		expect(codec.verify(`${forgedPayload}.${sigPart}`)).toBeNull();
	});

	it('HMAC-CODEC-09: a wrong-length signature is rejected (length-mismatch branch, no timing leak)', () => {
		const token = codec.sign({ userId: 'u1', exp: futureExp() });
		const payloadPart = token.slice(0, token.indexOf('.'));
		expect(codec.verify(`${payloadPart}.`)).toBeNull(); // empty signature (0 bytes vs 32)
		expect(codec.verify(`${payloadPart}.AAAA`)).toBeNull(); // 3 bytes vs 32
	});

	it('HMAC-CODEC-10: only the FIRST dot splits payload/signature — extra dots stay in the signature part', () => {
		const token = codec.sign({ userId: 'u1', exp: futureExp() });
		const payloadPart = token.slice(0, token.indexOf('.'));
		// `payload.a.b` → signaturePart = "a.b", which cannot match the real signature.
		expect(codec.verify(`${payloadPart}.a.b`)).toBeNull();
	});

	it('HMAC-CODEC-11: round-trips all payload fields verbatim (no field dropped or coerced)', () => {
		const rich = { userId: 'u-42', exp: futureExp(), role: 'operator', n: 7 } as TestPayload & {
			role: string;
			n: number;
		};
		expect(codec.verify(codec.sign(rich))).toEqual(rich);
	});
});
