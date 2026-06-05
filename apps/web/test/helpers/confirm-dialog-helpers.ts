import { fireEvent, screen, within } from '@testing-library/react';

export function clickDialogCancel() {
	fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
}

export function typeDialogChallenge(challenge: string) {
	const dialog = screen.getByRole('dialog');
	const input = within(dialog).getByRole('textbox');
	fireEvent.change(input, { target: { value: challenge } });
}

export function clickDialogConfirm(buttonName: string) {
	fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: buttonName }));
}

export async function acceptDialogWithChallenge(challenge: string, confirmButtonName: string) {
	await screen.findByRole('dialog');
	typeDialogChallenge(challenge);
	clickDialogConfirm(confirmButtonName);
}
