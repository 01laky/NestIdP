import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDocumentTitle } from './useDocumentTitle';

function TitleProbe({ title }: { title: string }) {
	useDocumentTitle(title);
	return null;
}

describe('useDocumentTitle', () => {
	it('WEB-ADM-38: sets document.title on mount and restores on unmount', () => {
		document.title = 'NestIdP';
		const { unmount, rerender } = render(<TitleProbe title="Dashboard — NestIdP Admin" />);
		expect(document.title).toBe('Dashboard — NestIdP Admin');
		rerender(<TitleProbe title="SP Connections — NestIdP Admin" />);
		expect(document.title).toBe('SP Connections — NestIdP Admin');
		unmount();
		expect(document.title).toBe('NestIdP');
	});
});
