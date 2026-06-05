import type { Response } from 'express';
import { existsSync } from 'fs';
import { SpaFallbackController } from '@api/spa/controllers/spa-fallback.controller';

jest.mock('fs', () => ({
	existsSync: jest.fn(),
}));

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

describe('SpaFallbackController', () => {
	const controller = new SpaFallbackController();

	const createMockResponse = () => {
		const json = jest.fn();
		const status = jest.fn().mockReturnValue({ json });
		const sendFile = jest.fn();
		return { json, status, sendFile } as unknown as Response & {
			json: jest.Mock;
			status: jest.Mock;
			sendFile: jest.Mock;
		};
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('serveLogin', () => {
		it('returns 503 JSON when web build is missing', () => {
			mockedExistsSync.mockReturnValue(false);
			const response = createMockResponse();
			controller.serveLogin(response);
			expect(response.status).toHaveBeenCalledWith(503);
			expect(response.status().json).toHaveBeenCalledWith({
				status: 'unavailable',
				message: 'Web build not found. Run pnpm build before production start.',
			});
		});

		it('sends index.html when web build exists', () => {
			mockedExistsSync.mockReturnValue(true);
			const response = createMockResponse();
			controller.serveLogin(response);
			expect(response.sendFile).toHaveBeenCalledTimes(1);
			expect(response.status).not.toHaveBeenCalled();
		});
	});

	describe('serveAdmin', () => {
		it('returns 503 JSON for /admin when web build is missing', () => {
			mockedExistsSync.mockReturnValue(false);
			const response = createMockResponse();
			controller.serveAdmin(response);
			expect(response.status).toHaveBeenCalledWith(503);
		});

		it('sends index.html for /admin when web build exists', () => {
			mockedExistsSync.mockReturnValue(true);
			const response = createMockResponse();
			controller.serveAdmin(response);
			expect(response.sendFile).toHaveBeenCalledTimes(1);
		});

		it('serves same index for nested admin paths', () => {
			mockedExistsSync.mockReturnValue(true);
			const response = createMockResponse();
			controller.serveAdmin(response);
			const firstCall = response.sendFile.mock.calls[0]?.[0];
			response.sendFile.mockClear();
			controller.serveAdmin(response);
			const secondCall = response.sendFile.mock.calls[0]?.[0];
			expect(firstCall).toBe(secondCall);
		});
	});
});
