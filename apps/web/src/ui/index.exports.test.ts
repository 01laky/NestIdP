import { describe, expect, it } from 'vitest';
import * as ui from './index';

const expectedExports = [
	'AppShell',
	'Badge',
	'Breadcrumbs',
	'BreadcrumbList',
	'Button',
	'ButtonLink',
	'Callout',
	'Card',
	'Checkbox',
	'CodeBlock',
	'EmptyState',
	'ErrorBanner',
	'Fieldset',
	'LoadingState',
	'MobileNavToggle',
	'OperatorSessionBar',
	'PageHeader',
	'Panel',
	'Select',
	'SidebarNav',
	'Spinner',
	'StatCard',
	'Table',
	'TextArea',
	'TextInput',
	'Toast',
	'ToastProvider',
	'useToast',
] as const;

describe('ui/index exports', () => {
	it('WEB-EVG-14: exports Button and AppShell', () => {
		expect(ui.Button).toBeTypeOf('function');
		expect(ui.AppShell).toBeTypeOf('function');
	});

	it('WEB-EVG-61: barrel exports all public primitives', () => {
		for (const name of expectedExports) {
			expect(ui[name as keyof typeof ui]).toBeDefined();
		}
	});
});
