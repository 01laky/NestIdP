import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './admin/AdminLayout';
import { LoginPage } from './login/LoginPage';

export function AppRoutes() {
	return (
		<Routes>
			<Route path="/login" element={<LoginPage />} />
			<Route path="/admin/*" element={<AdminLayout />} />
			<Route path="/" element={<Navigate to="/admin" replace />} />
			<Route path="*" element={<Navigate to="/admin" replace />} />
		</Routes>
	);
}
