import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { Callout } from './Callout';
import { Card } from './Card';
import { CodeBlock } from './CodeBlock';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { LoadingState } from './LoadingState';
import { Panel } from './Panel';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { StatCard } from './StatCard';
import { TextArea } from './TextArea';
import { TextInput } from './TextInput';

afterEach(() => {
	cleanup();
});

describe('Evergreen UI primitives — edge cases', () => {
	it('WEB-EVG-24: Badge applies variant class for all variants', () => {
		const variants = ['success', 'danger', 'info', 'neutral', 'warning'] as const;
		for (const variant of variants) {
			const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
			const el = screen.getByText(variant);
			expect(el.className).toContain(`evg-badge--${variant}`);
			unmount();
		}
	});

	it('WEB-EVG-25: Button variants map to evg-btn--* classes', () => {
		const cases: Array<{
			variant: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
			cls: string;
		}> = [
			{ variant: 'primary', cls: 'evg-btn--primary' },
			{ variant: 'secondary', cls: 'evg-btn--secondary' },
			{ variant: 'ghost', cls: 'evg-btn--ghost' },
			{ variant: 'danger', cls: 'evg-btn--danger' },
			{ variant: 'link', cls: 'evg-btn--link' },
		];
		for (const { variant, cls } of cases) {
			const { unmount } = render(<Button variant={variant}>{variant}</Button>);
			expect(screen.getByRole('button', { name: variant }).className).toContain(cls);
			unmount();
		}
	});

	it('WEB-EVG-26: Button block and sm size classes', () => {
		render(
			<Button block size="sm">
				Small block
			</Button>,
		);
		const btn = screen.getByRole('button', { name: 'Small block' });
		expect(btn.className).toContain('evg-btn--block');
		expect(btn.className).toContain('evg-btn--sm');
	});

	it('WEB-EVG-27: TextInput wires label, hint, error, and required mark', () => {
		render(
			<TextInput
				label="API token"
				name="token"
				hint="Paste Bearer token"
				error="Token required"
				requiredMark
			/>,
		);
		expect(screen.getByText(/API token/i)).toBeDefined();
		expect(screen.getByText('(required)')).toBeDefined();
		expect(screen.getByText('Paste Bearer token')).toBeDefined();
		expect(screen.getByText('Token required')).toBeDefined();
		expect(screen.getByLabelText(/API token/i).getAttribute('id')).toBe('token');
	});

	it('WEB-EVG-28: TextInput disabled passes through to input', () => {
		render(<TextInput label="Host" name="host" disabled />);
		expect((screen.getByLabelText(/Host/i) as HTMLInputElement).disabled).toBe(true);
	});

	it('WEB-EVG-29: Select and TextArea render field errors', () => {
		render(
			<>
				<Select label="Category" name="cat" error="Pick one">
					<option value="">—</option>
				</Select>
				<TextArea label="Notes" name="notes" error="Too long" />
			</>,
		);
		expect(screen.getByText('Pick one')).toBeDefined();
		expect(screen.getByText('Too long')).toBeDefined();
	});

	it('WEB-EVG-30: Panel exposes optional id anchor for deep links', () => {
		render(
			<Panel title="Security" id="change-password">
				<p>Form</p>
			</Panel>,
		);
		const panel = document.getElementById('change-password');
		expect(panel?.className).toContain('evg-panel');
		expect(screen.getByRole('heading', { name: 'Security' })).toBeDefined();
	});

	it('WEB-EVG-31: StatCard renders value and label structure', () => {
		render(<StatCard label="Users" value={42} />);
		expect(document.querySelector('.evg-stat__value')?.textContent).toBe('42');
		expect(screen.getByText('Users')).toBeDefined();
	});

	it('WEB-EVG-32: EmptyState optional description and action slot', () => {
		render(
			<EmptyState
				title="No connections"
				description="Create your first API connection."
				action={<Button variant="primary">Create</Button>}
			/>,
		);
		expect(screen.getByRole('heading', { name: 'No connections' })).toBeDefined();
		expect(screen.getByText(/Create your first/i)).toBeDefined();
		expect(screen.getByRole('button', { name: 'Create' })).toBeDefined();
	});

	it('WEB-EVG-33: ErrorBanner uses alert role', () => {
		render(<ErrorBanner message="Sync failed" />);
		expect(screen.getByRole('alert').textContent).toBe('Sync failed');
	});

	it('WEB-EVG-34: LoadingState and Spinner expose status role', () => {
		render(
			<>
				<LoadingState message="Loading audit…" />
				<Spinner label="Redirecting…" />
			</>,
		);
		const statuses = screen.getAllByRole('status');
		expect(statuses.some((n) => n.textContent?.includes('Loading audit'))).toBe(true);
		expect(statuses.some((n) => n.textContent?.includes('Redirecting'))).toBe(true);
	});

	it('WEB-EVG-35: CodeBlock uses evg-code-block pre wrapper', () => {
		render(<CodeBlock>-----BEGIN CERT-----</CodeBlock>);
		const pre = screen.getByText(/BEGIN CERT/);
		expect(pre.tagName).toBe('PRE');
		expect(pre.className).toContain('evg-code-block');
	});

	it('WEB-EVG-36: Callout success and info default to status role', () => {
		render(
			<>
				<Callout variant="success">Saved</Callout>
				<Callout variant="info">Note</Callout>
			</>,
		);
		const statuses = screen.getAllByRole('status');
		expect(statuses.length).toBe(2);
	});

	it('WEB-EVG-37: Card wraps children in evg-card', () => {
		render(
			<Card>
				<p>Inner</p>
			</Card>,
		);
		expect(document.querySelector('.evg-card')).toBeDefined();
	});
});
