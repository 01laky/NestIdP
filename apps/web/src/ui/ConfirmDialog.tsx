import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { evgButtonClasses } from './button-classes';
import { TextInput } from './TextInput';
import type { ConfirmTone, TypeToConfirmOptions } from './confirm-types';

export interface ConfirmDialogProps {
	open: boolean;
	title: string;
	description: string;
	detail?: React.ReactNode;
	confirmLabel: string;
	cancelLabel: string;
	tone: ConfirmTone;
	showAuditNote: boolean;
	typeToConfirm?: TypeToConfirmOptions;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	description,
	detail,
	confirmLabel,
	cancelLabel,
	tone,
	showAuditNote,
	typeToConfirm,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const { t } = useTranslation('common');
	const titleId = useId();
	const descId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const [typed, setTyped] = useState('');

	useEffect(() => {
		if (!open) {
			setTyped('');
			return;
		}
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const timer = window.setTimeout(() => cancelRef.current?.focus(), 0);
		return () => {
			window.clearTimeout(timer);
			document.body.style.overflow = prev;
		};
	}, [open]);

	const typeMismatch = typeToConfirm ? typed !== typeToConfirm.challenge : false;

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onCancel();
				return;
			}
			if (event.key === 'Enter' && tone !== 'danger' && !typeToConfirm) {
				const target = event.target as HTMLElement;
				if (target.tagName === 'TEXTAREA') {
					return;
				}
				event.preventDefault();
				onConfirm();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, tone, typeToConfirm, typed, onConfirm, onCancel]);

	if (!open) {
		return null;
	}

	const panelToneClass =
		tone === 'danger' ? 'evg-modal--danger' : tone === 'warning' ? 'evg-modal--warning' : '';
	const confirmVariant = tone === 'danger' ? 'danger' : 'primary';

	return createPortal(
		<div className="evg-modal" role="presentation">
			<button
				type="button"
				className="evg-modal__backdrop"
				aria-label={t('dismissDialog')}
				onClick={onCancel}
			/>
			<div
				className={`evg-modal__panel ${panelToneClass}`.trim()}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descId}
			>
				<header className="evg-modal__header">
					<h2 id={titleId} className="evg-modal__title">
						{title}
					</h2>
				</header>
				<div className="evg-modal__body">
					<p id={descId} className="evg-modal__description">
						{description}
					</p>
					{detail ? <div className="evg-modal__detail">{detail}</div> : null}
					{showAuditNote ? <p className="evg-modal__audit-note">{t('confirmAuditNote')}</p> : null}
					{typeToConfirm ? (
						<div className="evg-modal__type-field">
							<TextInput
								label={typeToConfirm.label}
								name="confirm-challenge"
								value={typed}
								onChange={(event) => setTyped(event.target.value)}
								autoComplete="off"
							/>
							{typeMismatch && typed.length > 0 ? (
								<p className="evg-field__error">{t('typeToConfirmMismatch')}</p>
							) : null}
						</div>
					) : null}
				</div>
				<footer className="evg-modal__footer">
					<button
						ref={cancelRef}
						type="button"
						className={evgButtonClasses({ variant: 'secondary' })}
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
					<Button
						type="button"
						variant={confirmVariant}
						disabled={typeMismatch}
						onClick={onConfirm}
					>
						{confirmLabel}
					</Button>
				</footer>
			</div>
		</div>,
		document.body,
	);
}
