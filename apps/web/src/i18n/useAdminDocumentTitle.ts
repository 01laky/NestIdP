import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../admin/components/hooks/useDocumentTitle';

export function useAdminDocumentTitle(pageTitle: string): void {
	const { t } = useTranslation('common');
	useDocumentTitle(t('documentTitleAdmin', { page: pageTitle }));
}
