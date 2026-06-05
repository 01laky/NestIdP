import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
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
				open={overrides.open ?? true}
				title="Title"
				description="Description text"
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

function renderProvider(ui: ReactNode, closeMobileNav = vi.fn()) {
	return render(
		<I18nextProvider i18n={getI18n()}>
			<ShellUiContext.Provider value={{ closeMobileNav }}>
				<ConfirmProvider>{ui}</ConfirmProvider>
			</ShellUiContext.Provider>
		</I18nextProvider>,
	);
}

afterEach(() => {
	cleanup();
	document.body.style.overflow = '';
});

describe('ConfirmDialog — extended edge', () => {
	it('WEB-EVG-CONF-21: open=false renders no dialog in document', () => {
		renderDialog({ open: false });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('WEB-EVG-CONF-22: portal mounts dialog under document.body', () => {
		renderDialog();
		const dialog = screen.getByRole('dialog');
		expect(dialog.closest('.evg-modal')?.parentElement).toBe(document.body);
	});

	it('WEB-EVG-CONF-23: body overflow hidden while open, restored on unmount', () => {
		const { unmount } = render(
			<I18nextProvider i18n={getI18n()}>
				<ConfirmDialog
					open
					title="T"
					description="D"
					confirmLabel="OK"
					cancelLabel="Cancel"
					tone="default"
					showAuditNote={false}
					onConfirm={() => {}}
					onCancel={() => {}}
				/>
			</I18nextProvider>,
		);
		expect(document.body.style.overflow).toBe('hidden');
		unmount();
		expect(document.body.style.overflow).toBe('');
	});

	it('WEB-EVG-CONF-24: danger tone applies evg-modal--danger on panel', () => {
		renderDialog({ tone: 'danger' });
		expect(document.querySelector('.evg-modal__panel.evg-modal--danger')).not.toBeNull();
	});

	it('WEB-EVG-CONF-25: Enter confirms on default tone without typeToConfirm', () => {
		const { onConfirm } = renderDialog({ tone: 'default' });
		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-CONF-26: Enter confirms on warning tone without typeToConfirm', () => {
		const { onConfirm } = renderDialog({ tone: 'warning' });
		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-CONF-27: typeToConfirm is case-sensitive (replace ≠ REPLACE)', () => {
		renderDialog({
			typeToConfirm: { challenge: 'REPLACE', label: 'Type REPLACE' },
		});
		const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'replace' } });
		expect(confirmBtn).toHaveProperty('disabled', true);
	});

	it('WEB-EVG-CONF-28: typeToConfirm mismatch message after non-empty wrong input', () => {
		renderDialog({
			typeToConfirm: { challenge: 'REPLACE', label: 'Type REPLACE' },
		});
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'REPL' } });
		expect(screen.getByText(/does not match/i)).toBeDefined();
	});

	it('WEB-EVG-CONF-29: typeToConfirm empty input hides mismatch message', () => {
		renderDialog({
			typeToConfirm: { challenge: 'REPLACE', label: 'Type REPLACE' },
		});
		expect(screen.queryByText(/does not match/i)).toBeNull();
	});

	it('WEB-EVG-CONF-30: backdrop uses dismissDialog aria-label (not duplicate Cancel name)', () => {
		renderDialog();
		expect(screen.getByRole('button', { name: 'Dismiss dialog' })).toBeDefined();
		const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
		expect(cancelButtons.length).toBe(1);
	});

	it('WEB-EVG-CONF-31: custom confirmLabel and cancelLabel render', () => {
		renderDialog({ confirmLabel: 'Delete forever', cancelLabel: 'Keep' });
		const dialog = screen.getByRole('dialog');
		expect(within(dialog).getByRole('button', { name: 'Delete forever' })).toBeDefined();
		expect(within(dialog).getByRole('button', { name: 'Keep' })).toBeDefined();
	});

	it('WEB-EVG-CONF-32: cancel button receives initial focus', async () => {
		renderDialog();
		await waitFor(() => {
			expect(document.activeElement?.textContent).toBe('Cancel');
		});
	});

	it('WEB-EVG-CONF-33: typed challenge resets when dialog closes and reopens', () => {
		const { rerender } = render(
			<I18nextProvider i18n={getI18n()}>
				<ConfirmDialog
					open
					title="T"
					description="D"
					confirmLabel="OK"
					cancelLabel="Cancel"
					tone="default"
					showAuditNote={false}
					typeToConfirm={{ challenge: 'X', label: 'Type X' }}
					onConfirm={() => {}}
					onCancel={() => {}}
				/>
			</I18nextProvider>,
		);
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'partial' } });
		rerender(
			<I18nextProvider i18n={getI18n()}>
				<ConfirmDialog
					open={false}
					title="T"
					description="D"
					confirmLabel="OK"
					cancelLabel="Cancel"
					tone="default"
					showAuditNote={false}
					typeToConfirm={{ challenge: 'X', label: 'Type X' }}
					onConfirm={() => {}}
					onCancel={() => {}}
				/>
			</I18nextProvider>,
		);
		rerender(
			<I18nextProvider i18n={getI18n()}>
				<ConfirmDialog
					open
					title="T"
					description="D"
					confirmLabel="OK"
					cancelLabel="Cancel"
					tone="default"
					showAuditNote={false}
					typeToConfirm={{ challenge: 'X', label: 'Type X' }}
					onConfirm={() => {}}
					onCancel={() => {}}
				/>
			</I18nextProvider>,
		);
		expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
	});
});

describe('ConfirmProvider / useConfirm — extended edge', () => {
	it('WEB-EVG-CONF-34: useConfirm throws outside ConfirmProvider', () => {
		function Bad() {
			useConfirm();
			return null;
		}
		expect(() =>
			render(
				<I18nextProvider i18n={getI18n()}>
					<Bad />
				</I18nextProvider>,
			),
		).toThrow(/ConfirmProvider/);
	});

	it('WEB-EVG-CONF-35: second confirm() while open resolves false immediately', async () => {
		let confirmFn!: ReturnType<typeof useConfirm>;
		function Harness() {
			confirmFn = useConfirm();
			return null;
		}
		renderProvider(<Harness />);
		const first = confirmFn({ title: 'A', description: 'a' });
		await waitFor(() => screen.getByRole('dialog'));
		await expect(confirmFn({ title: 'B', description: 'b' })).resolves.toBe(false);
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
		await expect(first).resolves.toBe(false);
	});

	it('WEB-EVG-CONF-36: confirm() calls closeMobileNav before showing dialog', async () => {
		const closeMobileNav = vi.fn();
		let confirmFn!: ReturnType<typeof useConfirm>;
		function Harness() {
			confirmFn = useConfirm();
			return null;
		}
		renderProvider(<Harness />, closeMobileNav);
		void confirmFn({ title: 'T', description: 'D' });
		await waitFor(() => screen.getByRole('dialog'));
		expect(closeMobileNav).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-CONF-37: focus returns to trigger element after cancel', async () => {
		let confirmFn!: ReturnType<typeof useConfirm>;
		function Harness() {
			const btnRef = useRef<HTMLButtonElement>(null);
			confirmFn = useConfirm();
			return (
				<button
					ref={btnRef}
					type="button"
					onClick={() => void confirmFn({ title: 'T', description: 'D' })}
				>
					Open
				</button>
			);
		}
		renderProvider(<Harness />);
		const trigger = screen.getByRole('button', { name: 'Open' });
		trigger.focus();
		fireEvent.click(trigger);
		await waitFor(() => screen.getByRole('dialog'));
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it('WEB-EVG-CONF-38: provider applies default common.confirm and cancel labels', async () => {
		let confirmFn!: ReturnType<typeof useConfirm>;
		function Harness() {
			confirmFn = useConfirm();
			return (
				<button type="button" onClick={() => void confirmFn({ title: 'T', description: 'D' })}>
					Go
				</button>
			);
		}
		renderProvider(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Go' }));
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDefined();
		expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDefined();
	});

	it('WEB-EVG-CONF-39: backdrop dismiss resolves false', async () => {
		let confirmFn!: ReturnType<typeof useConfirm>;
		function Harness() {
			confirmFn = useConfirm();
			return null;
		}
		renderProvider(<Harness />);
		const promise = confirmFn({ title: 'T', description: 'D' });
		await waitFor(() => screen.getByRole('dialog'));
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss dialog' }));
		await expect(promise).resolves.toBe(false);
	});
});

describe('useConfirmAction — extended edge', () => {
	it('WEB-EVG-CONF-40: cancel does not invoke onConfirm', async () => {
		const onConfirm = vi.fn();
		function Harness() {
			const confirmAction = useConfirmAction();
			return (
				<button
					type="button"
					onClick={() =>
						void confirmAction({
							title: 'Del',
							description: 'Sure?',
							onConfirm,
						})
					}
				>
					Go
				</button>
			);
		}
		renderProvider(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Go' }));
		await screen.findByRole('dialog');
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('WEB-EVG-CONF-41: awaits async onConfirm before resolving', async () => {
		const order: string[] = [];
		function Harness() {
			const confirmAction = useConfirmAction();
			return (
				<button
					type="button"
					onClick={() =>
						void confirmAction({
							title: 'Del',
							description: 'Sure?',
							onConfirm: async () => {
								order.push('start');
								await new Promise((r) => setTimeout(r, 10));
								order.push('end');
							},
						}).then(() => order.push('resolved'))
					}
				>
					Go
				</button>
			);
		}
		renderProvider(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Go' }));
		await screen.findByRole('dialog');
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
		await waitFor(() => expect(order).toEqual(['start', 'end', 'resolved']));
	});

	it('WEB-EVG-CONF-42: returns false when user cancels', async () => {
		let result: boolean | undefined;
		function Harness() {
			const confirmAction = useConfirmAction();
			return (
				<button
					type="button"
					onClick={() =>
						void confirmAction({
							title: 'Del',
							description: 'Sure?',
							onConfirm: async () => {},
						}).then((ok) => {
							result = ok;
						})
					}
				>
					Go
				</button>
			);
		}
		renderProvider(<Harness />);
		fireEvent.click(screen.getByRole('button', { name: 'Go' }));
		await screen.findByRole('dialog');
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(result).toBe(false));
	});
});
