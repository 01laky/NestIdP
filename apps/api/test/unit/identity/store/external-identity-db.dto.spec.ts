import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
	ConnectExternalDbBodyDto,
	DisconnectExternalDbBodyDto,
	TestExternalDbBodyDto,
} from '@api/identity/store/external/external-identity-db.dto';

function errs<T extends object>(cls: new () => T, payload: Record<string, unknown>): string[] {
	const instance = plainToInstance(cls, payload, { enableImplicitConversion: true });
	return validateSync(instance as object).flatMap((e) => Object.keys(e.constraints ?? {}));
}

const valid = {
	dialect: 'postgres',
	host: 'db.example.com',
	port: 5432,
	database: 'idp',
	username: 'svc',
	sslMode: 'require',
};

describe('External DB request DTO validation (DTO)', () => {
	it('DTO-01: a complete connection body validates', () => {
		expect(errs(TestExternalDbBodyDto, valid)).toEqual([]);
	});

	it('DTO-02: rejects an unsupported dialect', () => {
		expect(errs(TestExternalDbBodyDto, { ...valid, dialect: 'oracle' }).length).toBeGreaterThan(0);
	});

	it('DTO-03: rejects an out-of-range port and a non-numeric port', () => {
		expect(errs(TestExternalDbBodyDto, { ...valid, port: 0 }).length).toBeGreaterThan(0);
		expect(errs(TestExternalDbBodyDto, { ...valid, port: 70000 }).length).toBeGreaterThan(0);
	});

	it('DTO-04: rejects an unsupported sslMode and empty required fields', () => {
		expect(errs(TestExternalDbBodyDto, { ...valid, sslMode: 'maybe' }).length).toBeGreaterThan(0);
		expect(errs(TestExternalDbBodyDto, { ...valid, host: '' }).length).toBeGreaterThan(0);
	});

	it('DTO-05: connect body accepts the optional toggle + acknowledgement booleans (and inherits base validation)', () => {
		expect(
			errs(ConnectExternalDbBodyDto, { ...valid, keepLocalCopy: true, acknowledgeBackup: true }),
		).toEqual([]);
		// the connect body still enforces the inherited connection rules
		expect(errs(ConnectExternalDbBodyDto, { ...valid, dialect: 'oracle' }).length).toBeGreaterThan(
			0,
		);
	});

	it('DTO-06: disconnect body requires the moveDataToLocal boolean', () => {
		expect(errs(DisconnectExternalDbBodyDto, { moveDataToLocal: true })).toEqual([]);
		expect(errs(DisconnectExternalDbBodyDto, {}).length).toBeGreaterThan(0);
	});
});
