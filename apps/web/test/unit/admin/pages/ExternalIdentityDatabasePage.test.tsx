import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { clickDialogConfirm } from '@test/helpers/confirm-dialog-helpers';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalDbStatusResponseDto } from '@nestidp/shared';
import * as adminApi from '@/admin/adminApi';
import { ExternalIdentityDatabasePage } from '@/admin/pages/ExternalIdentityDatabasePage';

function fillConnForm() {
	fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'db.example.com' } });
	fireEvent.change(screen.getByLabelText('Database name'), { target: { value: 'idp' } });
	fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'svc' } });
}

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

	it('WEB-EXTDB-05: Preview renders ownership, counts and conflicts', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		vi.spyOn(adminApi, 'previewExternalIdentityDb').mockResolvedValue({
			reachable: true,
			ownership: 'ours',
			schemaPresent: true,
			willWipeLocal: true,
			toCreate: { users: 3, groups: 1, roles: 0 },
			toUpdate: { users: 2, groups: 0, roles: 0 },
			conflicts: [{ kind: 'username', table: 'user', value: 'dup' }],
		});
		renderPage();
		await screen.findByText(/Connect an external database/i);
		fillConnForm();
		fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
		expect(await screen.findByTestId('external-db-preview')).toBeTruthy();
		expect(screen.getByText(/Already contains our data/i)).toBeTruthy();
		expect(screen.getByText(/user\.username=dup/i)).toBeTruthy();
	});

	it('WEB-EXTDB-06: Connect submits the request and surfaces the wipe-skipped toast', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		const connect = vi.spyOn(adminApi, 'connectExternalIdentityDb').mockResolvedValue({
			status: active(),
			imported: { users: 2, groups: 0, roles: 0 },
			localWiped: false,
			wipeSkipped: true,
		});
		renderPage();
		await screen.findByText(/Connect an external database/i);
		fillConnForm();
		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
		expect(connect.mock.calls[0][0]).toMatchObject({
			host: 'db.example.com',
			keepLocalCopy: false,
		});
		expect(await screen.findByText(/local identity was kept/i)).toBeTruthy();
	});

	it('WEB-EXTDB-07: Disconnect confirms and calls the API', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(active());
		const disconnect = vi
			.spyOn(adminApi, 'disconnectExternalIdentityDb')
			.mockResolvedValue(notConfigured());
		renderPage();
		await screen.findByRole('button', { name: 'Disconnect' });
		fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Move data back & disconnect');
		await waitFor(() => expect(disconnect).toHaveBeenCalledWith({ moveDataToLocal: true }));
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
