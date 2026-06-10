import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { clickDialogConfirm } from '@test/helpers/confirm-dialog-helpers';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalDbStatusResponseDto } from '@nestidp/shared';
import * as adminApi from '@/admin/adminApi';
import { AdminApiError } from '@/admin/adminApi';
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

/**
 * The five action error paths (Prompt 38 §8): every catch funnels through mapAdminError with an
 * externalDb.* fallback key — an AdminApiError with a server message surfaces that message, an
 * AdminApiError with a blank message or a plain Error degrades to the translated fallback toast.
 */
describe('ExternalIdentityDatabasePage error paths', () => {
	it('WEB-EXTDB-ERR-01: failed Test connection surfaces the AdminApiError server message', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		vi.spyOn(adminApi, 'testExternalIdentityDb').mockRejectedValue(
			new AdminApiError(500, 'external db exploded'),
		);
		renderPage();
		await screen.findByText(/Connect an external database/i);
		fillConnForm();
		fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
		expect(await screen.findByText('external db exploded')).toBeTruthy();
	});

	it('WEB-EXTDB-ERR-02: failed Test connection with a plain Error falls back to connectionTestFailed', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		vi.spyOn(adminApi, 'testExternalIdentityDb').mockRejectedValue(new Error('boom'));
		renderPage();
		await screen.findByText(/Connect an external database/i);
		fillConnForm();
		fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
		expect(await screen.findByText('Failed to test the connection')).toBeTruthy();
		// the raw error message must not leak to the operator
		expect(screen.queryByText('boom')).toBeNull();
		// busy state is released after the failure
		await waitFor(() =>
			expect(
				(screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled,
			).toBe(false),
		);
	});

	it('WEB-EXTDB-ERR-03: failed Preview falls back to previewFailed and renders no preview panel', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		vi.spyOn(adminApi, 'previewExternalIdentityDb').mockRejectedValue(new Error('boom'));
		renderPage();
		await screen.findByText(/Connect an external database/i);
		fillConnForm();
		fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
		expect(await screen.findByText('Failed to preview the connection')).toBeTruthy();
		expect(screen.queryByTestId('external-db-preview')).toBeNull();
	});

	it('WEB-EXTDB-ERR-04: failed Connect falls back to connectFailed and keeps the form visible', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(notConfigured());
		vi.spyOn(adminApi, 'connectExternalIdentityDb').mockRejectedValue(new Error('boom'));
		renderPage();
		await screen.findByText(/Connect an external database/i);
		fillConnForm();
		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		expect(await screen.findByText('Failed to connect the external database')).toBeTruthy();
		// still not configured → connect form stays
		expect(screen.getByText(/Connect an external database/i)).toBeTruthy();
	});

	it('WEB-EXTDB-ERR-05: failed Re-sync surfaces the AdminApiError server message', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(active());
		vi.spyOn(adminApi, 'resyncExternalIdentityDb').mockRejectedValue(
			new AdminApiError(503, 'resync exploded'),
		);
		renderPage();
		await screen.findByRole('button', { name: 'Re-sync' });
		fireEvent.click(screen.getByRole('button', { name: 'Re-sync' }));
		expect(await screen.findByText('resync exploded')).toBeTruthy();
	});

	it('WEB-EXTDB-ERR-06: failed Re-sync with a plain Error falls back to resyncFailed', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(active());
		vi.spyOn(adminApi, 'resyncExternalIdentityDb').mockRejectedValue(new Error('boom'));
		renderPage();
		await screen.findByRole('button', { name: 'Re-sync' });
		fireEvent.click(screen.getByRole('button', { name: 'Re-sync' }));
		expect(await screen.findByText('Failed to re-sync the external database')).toBeTruthy();
	});

	it('WEB-EXTDB-ERR-07: failed Disconnect with a blank AdminApiError message falls back to disconnectFailed', async () => {
		vi.spyOn(adminApi, 'getExternalIdentityDbStatus').mockResolvedValue(active());
		const disconnect = vi
			.spyOn(adminApi, 'disconnectExternalIdentityDb')
			.mockRejectedValue(new AdminApiError(500, ''));
		renderPage();
		await screen.findByRole('button', { name: 'Disconnect' });
		fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Move data back & disconnect');
		await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
		expect(await screen.findByText('Failed to disconnect the external database')).toBeTruthy();
		// status panel still shows the (unchanged) active connection
		expect(screen.getByTestId('external-db-status').textContent).toContain('active');
	});
});
