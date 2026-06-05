import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '@/ui/ToastProvider';

function ToastProbe() {
	const { showToast } = useToast();
	return (
		<button type="button" onClick={() => showToast('Saved successfully')}>
			Enqueue
		</button>
	);
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

beforeEach(() => {
	vi.useRealTimers();
});

describe('ToastProvider', () => {
	it('WEB-EVG-51: useToast throws outside provider', () => {
		function BadConsumer() {
			useToast();
			return null;
		}
		expect(() => render(<BadConsumer />)).toThrow(/ToastProvider/);
	});

	it('WEB-EVG-52: toast region uses aria-live polite', () => {
		render(
			<ToastProvider>
				<ToastProbe />
			</ToastProvider>,
		);
		expect(document.querySelector('.evg-toast-region')?.getAttribute('aria-live')).toBe('polite');
	});

	it('WEB-EVG-53: queues at most three toasts (drops oldest)', () => {
		function MultiToast() {
			const { showToast } = useToast();
			return (
				<button
					type="button"
					onClick={() => {
						showToast('one');
						showToast('two');
						showToast('three');
						showToast('four');
					}}
				>
					Flood
				</button>
			);
		}
		render(
			<ToastProvider>
				<MultiToast />
			</ToastProvider>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Flood' }));
		const toasts = screen.getAllByRole('status');
		expect(toasts.length).toBe(3);
		expect(toasts.some((t) => t.textContent?.includes('one'))).toBe(false);
		expect(toasts.some((t) => t.textContent?.includes('four'))).toBe(true);
	});

	it('WEB-EVG-15: shows and dismisses success toast', async () => {
		render(
			<ToastProvider>
				<ToastProbe />
			</ToastProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Enqueue' }));

		await waitFor(() => {
			expect(screen.getByRole('status').textContent).toContain('Saved successfully');
		});

		fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

		await waitFor(() => {
			expect(screen.queryByRole('status')).toBeNull();
		});
	});
});
