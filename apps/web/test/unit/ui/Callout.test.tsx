import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Callout } from '@/ui/Callout';

afterEach(() => {
	cleanup();
});

describe('Callout', () => {
	it('WEB-EVG-05: warning uses status role by default', () => {
		render(<Callout variant="warning">Heads up</Callout>);
		const node = screen.getByRole('status');
		expect(node.textContent).toContain('Heads up');
		expect(node.className).toContain('evg-callout--warning');
	});

	it('WEB-EVG-05b: danger uses alert role by default', () => {
		render(<Callout variant="danger">Failed</Callout>);
		expect(screen.getByRole('alert').textContent).toContain('Failed');
	});
});
