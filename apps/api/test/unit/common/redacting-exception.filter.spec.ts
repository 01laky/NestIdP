import { ArgumentsHost, BadRequestException, HttpException, Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { RedactingExceptionFilter } from '@api/common/filters/redacting-exception.filter';

describe('RedactingExceptionFilter (§16)', () => {
	function makeAdapter() {
		return {
			reply: jest.fn(),
			end: jest.fn(),
			isHeadersSent: jest.fn(() => false),
		};
	}

	function makeHost(): ArgumentsHost {
		return {
			switchToHttp: () => ({
				getResponse: () => ({}),
				getRequest: () => ({}),
			}),
			getArgByIndex: jest.fn(),
			getArgs: jest.fn(() => []),
			getType: jest.fn(() => 'http'),
			switchToRpc: jest.fn(),
			switchToWs: jest.fn(),
		} as unknown as ArgumentsHost;
	}

	function makeFilter(adapter: ReturnType<typeof makeAdapter>) {
		return new RedactingExceptionFilter({
			httpAdapter: adapter,
		} as unknown as HttpAdapterHost);
	}

	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterAll(() => {
		jest.restoreAllMocks();
	});

	it('API-REDFLT-01: HttpException message embedding a bearer token is redacted, status kept', () => {
		const adapter = makeAdapter();
		const filter = makeFilter(adapter);
		filter.catch(
			new BadRequestException('upstream rejected: authorization: Bearer super-secret-token-value'),
			makeHost(),
		);

		expect(adapter.reply).toHaveBeenCalledTimes(1);
		const [, body, status] = adapter.reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		expect(status).toBe(400);
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain('super-secret-token-value');
		expect(serialized).toContain('[redacted]');
		// shape preserved: still the standard { statusCode, message, error } payload
		expect(body.statusCode).toBe(400);
		expect(body.error).toBe('Bad Request');
	});

	it('API-REDFLT-02: nested response payload strings (incl. message arrays) are redacted', () => {
		const adapter = makeAdapter();
		const filter = makeFilter(adapter);
		filter.catch(
			new HttpException(
				{
					statusCode: 400,
					message: ['client_secret=top-secret-value must be valid', 'name is required'],
					error: 'Bad Request',
				},
				400,
			),
			makeHost(),
		);

		const [, body] = adapter.reply.mock.calls[0] as [unknown, Record<string, unknown>];
		const messages = body.message as string[];
		expect(messages[0]).toContain('client_secret=[redacted]');
		expect(messages[1]).toBe('name is required');
		expect(body.error).toBe('Bad Request');
	});

	it('API-REDFLT-03: clean HttpException passes through with identical payload', () => {
		const adapter = makeAdapter();
		const filter = makeFilter(adapter);
		filter.catch(new BadRequestException('plain validation problem'), makeHost());

		const [, body, status] = adapter.reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		expect(status).toBe(400);
		expect(body.message).toBe('plain validation problem');
	});

	it('API-REDFLT-04: a plain Error stays a generic 500 (nothing from the message leaks)', () => {
		const adapter = makeAdapter();
		const filter = makeFilter(adapter);
		filter.catch(new Error('password=hunter2 leaked into an unexpected throw'), makeHost());

		expect(adapter.reply).toHaveBeenCalledTimes(1);
		const [, body, status] = adapter.reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		expect(status).toBe(500);
		expect(JSON.stringify(body)).not.toContain('hunter2');
		expect(body.message).toBe('Internal server error');
	});
});
