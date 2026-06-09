import { spawnSync } from 'node:child_process';
import { runOpenssl } from '@api/saml/utils/openssl.util';

jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

const spawnSyncMock = spawnSync as unknown as jest.Mock;

/**
 * Edge-case coverage for `runOpenssl` (Prompt 38 §5.A1). The security guarantee is that the binary is
 * invoked with an explicit argv array and NO shell, so operator-controlled values (the cert CN) can never
 * inject a command. These tests pin the invocation shape and every error path the old `execSync` had.
 */
describe('runOpenssl (§5.A1)', () => {
	beforeEach(() => {
		spawnSyncMock.mockReset();
	});

	it('API-OPENSSL-01: invokes openssl with the argv array, no shell, piped stdio', () => {
		spawnSyncMock.mockReturnValue({ status: 0, stderr: Buffer.from('') });
		const args = ['req', '-x509', '-subj', '/CN=evil"; rm -rf / #'];
		runOpenssl(args);
		expect(spawnSyncMock).toHaveBeenCalledTimes(1);
		const [bin, passedArgs, opts] = spawnSyncMock.mock.calls[0];
		expect(bin).toBe('openssl');
		expect(passedArgs).toEqual(args);
		// No `shell: true` — the metacharacter-laden CN is a literal argv element.
		expect(opts).toMatchObject({ stdio: 'pipe' });
		expect(opts.shell).toBeUndefined();
	});

	it('API-OPENSSL-02: status 0 resolves without throwing', () => {
		spawnSyncMock.mockReturnValue({ status: 0, stderr: Buffer.from('') });
		expect(() => runOpenssl(['version'])).not.toThrow();
	});

	it('API-OPENSSL-03: a non-zero exit status throws and includes the status + stderr', () => {
		spawnSyncMock.mockReturnValue({ status: 1, stderr: Buffer.from('unknown option -bogus') });
		expect(() => runOpenssl(['-bogus'])).toThrow(/status 1/);
		expect(() => runOpenssl(['-bogus'])).toThrow(/unknown option -bogus/);
	});

	it('API-OPENSSL-04: a non-zero exit with empty stderr still throws with the status', () => {
		spawnSyncMock.mockReturnValue({ status: 2, stderr: Buffer.from('') });
		expect(() => runOpenssl(['x'])).toThrow('openssl exited with status 2');
	});

	it('API-OPENSSL-05: a missing binary (ENOENT) throws the PATH-specific message', () => {
		const enoent = Object.assign(new Error('spawn openssl ENOENT'), { code: 'ENOENT' });
		spawnSyncMock.mockReturnValue({ error: enoent });
		expect(() => runOpenssl(['version'])).toThrow(/openssl binary not found on PATH/);
	});

	it('API-OPENSSL-06: a non-ENOENT spawn error is surfaced with its message', () => {
		const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
		spawnSyncMock.mockReturnValue({ error: eacces });
		expect(() => runOpenssl(['version'])).toThrow(/openssl invocation failed: permission denied/);
	});

	it('API-OPENSSL-07: a null/undefined status (signal-killed) is not treated as a failure', () => {
		// status is only checked when it is a number; a signal-terminated run leaves status null.
		spawnSyncMock.mockReturnValue({ status: null, signal: 'SIGTERM', stderr: Buffer.from('') });
		expect(() => runOpenssl(['version'])).not.toThrow();
	});
});
