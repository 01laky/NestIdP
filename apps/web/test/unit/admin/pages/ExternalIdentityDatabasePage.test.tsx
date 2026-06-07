import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalDbStatusResponseDto } from '@nestidp/shared';
import * as adminApi from '@/admin/adminApi';
import { ExternalIdentityDatabasePage } from '@/admin/pages/ExternalIdentityDatabasePage';

function notConfigured(): ExternalDbStatusResponseDto {
	return {
		configured: false,
		status: 'disconnected',
		mode: 'relocate',
		keepLocalCopy: false,
		hasPassword: false,
		reachable: false,
		outOfSync: false,
		schemaVersion: 0,
	};
}

function active(): ExternalDbStatusResponseDto {
	return {
		configured: true,
		status: 'active',
		mode: 'relocate',
		dialect: 'postgres',
		keepLocalCopy: false,
		hasPassword: true,
		reachable: true,
		outOfSync: false,
		schemaVersion: 1,
		counts: { users: 3, groups: 2, roles: 1 },
	};
}

function renderPage() {
	return renderWithUi(
		<MemoryRouter>
			<ExternalIdentityDatabasePage />
		</MemoryRouter>,
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('ExternalIdentityDatabasePage', () => {
	it('WEB-EXTDB-01: shows the connect form when not configured', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		renderPage();
		await screen.findByText('External identity database');
		expect(screen.getByText(/Connect an external database/i)).toBeTruthy();
		// at-rest warning is shown
		expect(screen.getByText(/not covered by the local at-rest encryption/i)).toBeTruthy();
	});

	it('WEB-EXTDB-02: Test connection calls the API', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		const test = vi
			.spyOn(adminApi, 'testExternalIdentityDb')
			.mockResolvedValue({ ok: true, dialect: 'postgres' });
		renderPage();
		await screen.findByText(/Connect an external database/i);
		fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'db.example.com' } });
		fireEvent.change(screen.getByLabelText('Database name'), { target: { value: 'idp' } });
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'svc' } });
		fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
		await waitFor(() => expect(test).toHaveBeenCalledTimes(1));
		expect(test.mock.calls[0][0]).toMatchObject({
			host: 'db.example.com',
			database: 'idp',
			username: 'svc',
		});
	});

	it('WEB-EXTDB-03: relocate shows the backup acknowledgement checkbox', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		renderPage();
		await screen.findByText(/Connect an external database/i);
		// keepLocalCopy is off by default → relocate warning + ack checkbox visible
		expect(screen.getByText(/Relocate mode copies identity/i)).toBeTruthy();
		expect(
			screen.getByLabelText(/local identity will be backed up and then deleted/i),
		).toBeTruthy();
	});

	it('WEB-EXTDB-04: shows status + Re-sync/Disconnect when active', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(active());
		renderPage();
		expect((await screen.findByTestId('external-db-status')).textContent).toContain('active');
		expect(screen.getByRole('button', { name: 'Re-sync' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
		// connect form hidden while configured
		expect(screen.queryByText(/Connect an external database/i)).toBeNull();
	});
});
