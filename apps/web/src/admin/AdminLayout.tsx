import { Link, Route, Routes } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';

export function AdminLayout() {
	return (
		<div className="layout">
			<div className="card">
				<h1>NestIdP Admin</h1>
				<p className="muted">
					Operator console scaffold — configuration UI comes in a later prompt.
				</p>
				<ul>
					<li>
						API connections (identity sync): <code>{API_CONNECTION_ROUTE_PREFIX}</code>
					</li>
					<li>
						SP connections (SAML apps): <code>{SP_CONNECTION_ROUTE_PREFIX}</code>
					</li>
				</ul>
				<Routes>
					<Route
						index
						element={
							<p className="muted">Dashboard placeholder for sync status and connection counts.</p>
						}
					/>
					<Route path="*" element={<p className="muted">Admin sub-route placeholder.</p>} />
				</Routes>
				<p>
					<Link to="/login">Go to SAML login page</Link>
				</p>
			</div>
		</div>
	);
}
