import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18nForTests } from '@/i18n/I18nProvider';
import { getI18n } from '@/i18n/i18n';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { ConfirmProvider } from '@/ui/ConfirmProvider';
import { ShellUiContext } from '@/ui/shell-ui-context';
import { useConfirm } from '@/ui/useConfirm';
import { useConfirmAction } from '@/ui/useConfirmAction';

await initI18nForTests('en');

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
	const onConfirm = vi.fn();
	const onCancel = vi.fn();
	render(
		<I18nextProvider i18n={getI18n()}>
			<ConfirmDialog
				open
				title="Delete item?"
				description="This cannot be undone."
				confirmLabel="Confirm"
				cancelLabel="Cancel"
				tone="default"
				showAuditNote={false}
				onConfirm={onConfirm}
				onCancel={onCancel}
				{...overrides}
			/>
		</I18nextProvider>,
	);
	return { onConfirm, onCancel };
}

function ConfirmHarness({
	children,
	onReady,
}: {
	children?: ReactNode;
	onReady: (confirm: ReturnType<typeof useConfirm>) => void;
}) {
	const confirm = useConfirm();
	onReady(confirm);
	return <>{children}</>;
}

function renderProvider(ui: ReactNode) {
	return render(
		<I18nextProvider i18n={getI18n()}>
			<ShellUiContext.Provider value={{ closeMobileNav: () => {} }}>
				<ConfirmProvider>{ui}</ConfirmProvider>
			</ShellUiContext.Provider>
		</I18nextProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe('ConfirmDialog', () => {
	it('WEB-EVG-CONF-01: renders title, body, both buttons when open', () => {
		renderDialog();
		expect(screen.getByRole('dialog')).toBeDefined();
		expect(screen.getByText('Delete item?')).toBeDefined();
		expect(screen.getByText('This cannot be undone.')).toBeDefined();
		const dialog = screen.getByRole('dialog');
		expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDefined();
		expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDefined();
	});

	it('WEB-EVG-CONF-02: Cancel button calls onCancel', () => {
		const { onCancel } = renderDialog();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-CONF-03: Confirm button calls onConfirm', () => {
		const { onConfirm } = renderDialog();
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-CONF-04: tone danger applies danger class on confirm button', () => {
		renderDialog({ tone: 'danger' });
		const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
		expect(confirmBtn.className).toContain('evg-btn--danger');
	});

	it('WEB-EVG-CONF-14: tone warning applies evg-modal--warning, confirm stays primary', () => {
		renderDialog({ tone: 'warning' });
		expect(document.querySelector('.evg-modal--warning')).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Confirm' }).className).toContain('evg-btn--primary');
	});

	it('WEB-EVG-CONF-15: typeToConfirm disables Confirm until challenge matches', () => {
		renderDialog({
			typeToConfirm: { challenge: 'REPLACE', label: 'Type REPLACE to confirm' },
		});
		const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
		expect(confirmBtn).toHaveProperty('disabled', true);
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'REPLACE' } });
		expect(confirmBtn).toHaveProperty('disabled', false);
	});

	it('WEB-EVG-CONF-16: showAuditNote renders common.confirmAuditNote', () => {
		renderDialog({ showAuditNote: true });
		expect(screen.getByText(/recorded in the audit log/i)).toBeDefined();
	});

	it('WEB-EVG-CONF-17: Enter key does not confirm when tone danger', () => {
		const { onConfirm } = renderDialog({ tone: 'danger' });
		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('WEB-EVG-CONF-18: Enter key does not confirm when typeToConfirm set', () => {
		const { onConfirm } = renderDialog({
			typeToConfirm: { challenge: 'X', label: 'Type X' },
		});
		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('WEB-EVG-CONF-19: detail slot renders member list markup', () => {
		renderDialog({
			detail: (
				<ul className="evg-list">
					<li>alice</li>
					<li>bob</li>
				</ul>
			),
		});
		const detail = document.querySelector('.evg-modal__detail');
		expect(detail?.textContent).toContain('alice');
		expect(detail?.textContent).toContain('bob');
	});

	it('WEB-EVG-CONF-05: Escape key triggers cancel', () => {
		const { onCancel } = renderDialog();
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-CONF-06: backdrop click triggers cancel', () => {
		const { onCancel } = renderDialog();
		fireEvent.click(document.querySelector('.evg-modal__backdrop')!);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-CONF-12: dialog has aria-modal and labelledby/describedby', () => {
		renderDialog();
		const dialog = screen.getByRole('dialog');
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		const labelledby = dialog.getAttribute('aria-labelledby');
		const describedby = dialog.getAttribute('aria-describedby');
		expect(labelledby).toBeTruthy();
		expect(describedby).toBeTruthy();
		expect(document.getElementById(labelledby!)?.textContent).toContain('Delete item?');
		expect(document.getElementById(describedby!)?.textContent).toContain('cannot be undone');
	});
});

describe('ConfirmProvider / useConfirm', () => {
	it('WEB-EVG-CONF-08: useConfirm resolves false when cancelled', async () => {
		let confirmFn!: ReturnType<typeof useConfirm>;
		renderProvider(
			<ConfirmHarness
				onReady={(fn) => {
					confirmFn = fn;
				}}
			/>,
		);
		const promise = confirmFn({ title: 'T', description: 'D' });
		await waitFor(() => screen.getByRole('dialog'));
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
		await expect(promise).resolves.toBe(false);
	});

	it('WEB-EVG-CONF-09: useConfirm resolves true when confirmed', async () => {
		let confirmFn!: ReturnType<typeof useConfirm>;
		renderProvider(
			<ConfirmHarness
				onReady={(fn) => {
					confirmFn = fn;
				}}
			/>,
		);
		const promise = confirmFn({ title: 'T', description: 'D' });
		await waitFor(() => screen.getByRole('dialog'));
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
		await expect(promise).resolves.toBe(true);
	});
});

describe('useConfirmAction', () => {
	it('WEB-EVG-CONF-20: runs onConfirm only after confirm', async () => {
		const onConfirm = vi.fn();
		function ActionHarness() {
			const confirmAction = useConfirmAction();
			return (
				<button
					type="button"
					onClick={() =>
						void confirmAction({
							title: 'Delete?',
							description: 'Sure?',
							tone: 'danger',
							onConfirm,
						})
					}
				>
					Trigger
				</button>
			);
		}
		renderProvider(<ActionHarness />);
		fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
		await waitFor(() => screen.getByRole('dialog'));
		expect(onConfirm).not.toHaveBeenCalled();
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
		await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
	});
});
