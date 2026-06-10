import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { redactSecrets } from '../../encryption/utils/redact-secret.util';

const MAX_REDACTION_DEPTH = 8;

/**
 * Global last-line-of-defense filter (Prompt 38 §5.B10/§16): every string that leaves through an error
 * response is passed through {@link redactSecrets} so a credential embedded in an exception message
 * (bearer token, PEM, client_secret, …) can never reach the client. Response shapes and status codes are
 * untouched — HttpExceptions keep their `getResponse()` payload (strings redacted in place), and
 * non-HttpExceptions still fall through to Nest's default generic 500.
 */
@Catch()
export class RedactingExceptionFilter extends BaseExceptionFilter {
	constructor(adapterHost: HttpAdapterHost) {
		super(adapterHost.httpAdapter);
	}

	catch(exception: unknown, host: ArgumentsHost): void {
		if (exception instanceof HttpException) {
			const original = exception.getResponse();
			const redacted = redactValue(original, 0);
			if (redacted !== original) {
				super.catch(
					new HttpException(redacted as string | Record<string, unknown>, exception.getStatus(), {
						cause: exception,
					}),
					host,
				);
				return;
			}
		}
		super.catch(exception, host);
	}
}

/** Redact every string reachable in the payload; return the input unchanged when nothing matched. */
function redactValue(value: unknown, depth: number): unknown {
	if (typeof value === 'string') {
		const redacted = redactSecrets(value);
		return redacted === value ? value : redacted;
	}
	if (depth >= MAX_REDACTION_DEPTH || value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		let changed = false;
		const out = value.map((item) => {
			const next = redactValue(item, depth + 1);
			changed = changed || next !== item;
			return next;
		});
		return changed ? out : value;
	}
	let changed = false;
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		const next = redactValue(item, depth + 1);
		changed = changed || next !== item;
		out[key] = next;
	}
	return changed ? out : value;
}
