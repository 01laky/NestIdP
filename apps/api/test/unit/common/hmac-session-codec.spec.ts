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
});
