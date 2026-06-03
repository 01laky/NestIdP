import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SpAttributeMappingConfig } from '@nestidp/shared';
import { SAML_NAME_ID_FORMATS, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import {
	AdminApiError,
	createSpConnection,
	deleteSpConnection,
	getSpConnection,
	testSpConnectionAcs,
	updateSpConnection,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { AttributeMappingEditor } from '../components/AttributeMappingEditor';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Button, Checkbox, Panel, Select, TextArea, TextInput, useToast } from '../../ui';

export function SpConnectionFormPage() {
	const { id } = useParams();
	const isNew = !id;
	const navigate = useNavigate();
	useDocumentTitle(isNew ? 'New SP — NestIdP Admin' : 'Edit SP — NestIdP Admin');

	const [loading, setLoading] = useState(!isNew);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [spEntityId, setSpEntityId] = useState('');
	const [acsUrl, setAcsUrl] = useState('');
	const [nameIdFormat, setNameIdFormat] = useState('');
	const [active, setActive] = useState(true);
	const [attributeMapping, setAttributeMapping] = useState<SpAttributeMappingConfig | null>(null);
	const [spCertificate, setSpCertificate] = useState('');
	const [acsTestMessage, setAcsTestMessage] = useState<string | null>(null);
	const { showToast } = useToast();
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (isNew || !id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const item = await getSpConnection(id);
				if (!cancelled) {
					setName(item.name);
					setSpEntityId(item.spEntityId);
					setAcsUrl(item.acsUrl);
					setNameIdFormat(item.nameIdFormat);
					setActive(item.active);
					setAttributeMapping(item.attributeMapping);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load SP');
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [id, isNew]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		const body = {
			name,
			spEntityId,
			acsUrl,
			nameIdFormat: nameIdFormat || undefined,
			active,
			attributeMapping,
			spCertificate: spCertificate.trim() ? spCertificate.trim() : null,
		};
		try {
			if (isNew) {
				const created = await createSpConnection(body);
				showToast('SP connection saved');
				navigate(`${SP_CONNECTION_ROUTE_PREFIX}/${created.item.id}`);
			} else if (id) {
				await updateSpConnection(id, body);
				showToast('SP connection saved');
			}
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	}

	async function handleDeactivateAndDelete() {
		if (!id) {
			return;
		}
		if (!window.confirm('Deactivate SP first, then delete?')) {
			return;
		}
		try {
			if (active) {
				await updateSpConnection(id, { active: false });
			}
			await deleteSpConnection(id);
			navigate(SP_CONNECTION_ROUTE_PREFIX);
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Delete failed');
		}
	}

	async function handleTestAcs() {
		if (!id) {
			return;
		}
		try {
			const result = await testSpConnectionAcs(id);
			setAcsTestMessage(result.message);
		} catch (err) {
			setAcsTestMessage(err instanceof AdminApiError ? err.message : 'ACS test failed');
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={isNew ? 'New SP connection' : 'Edit SP connection'}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'SP connections', to: SP_CONNECTION_ROUTE_PREFIX },
					{ label: isNew ? 'New' : name || id! },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<Panel title="SP connection">
				<form
					className="evg-stack"
					aria-busy={saving}
					onSubmit={(event) => void handleSubmit(event)}
				>
					<fieldset className="evg-stack" disabled={saving}>
						<TextInput
							label="Name"
							name="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							requiredMark
						/>
						<TextInput
							label="SP Entity ID"
							name="spEntityId"
							value={spEntityId}
							onChange={(e) => setSpEntityId(e.target.value)}
							required
							requiredMark
						/>
						<TextInput
							label="ACS URL"
							name="acsUrl"
							value={acsUrl}
							onChange={(e) => setAcsUrl(e.target.value)}
							required
							requiredMark
						/>
						<Select
							label="NameID format"
							value={nameIdFormat}
							onChange={(e) => setNameIdFormat(e.target.value)}
						>
							<option value="">(default)</option>
							{SAML_NAME_ID_FORMATS.map((format) => (
								<option key={format} value={format}>
									{format}
								</option>
							))}
						</Select>
						<Checkbox label="Active" checked={active} onChange={setActive} />
						<AttributeMappingEditor
							value={attributeMapping}
							onChange={setAttributeMapping}
							disabled={saving}
						/>
						<TextArea
							label="SP certificate PEM (optional)"
							rows={4}
							hint="Paste PEM certificate for SP signature verification."
							value={spCertificate}
							onChange={(e) => setSpCertificate(e.target.value)}
						/>
						<Button type="submit" variant="primary" disabled={saving}>
							{saving ? 'Saving…' : 'Save'}
						</Button>
					</fieldset>
				</form>
			</Panel>
			{!isNew && id ? (
				<div className="evg-cluster">
					<Button
						type="button"
						variant="secondary"
						disabled={saving}
						onClick={() => void handleTestAcs()}
					>
						Test ACS reachability
					</Button>
					<Button
						type="button"
						variant="danger"
						disabled={saving}
						onClick={() => void handleDeactivateAndDelete()}
					>
						Deactivate & delete
					</Button>
					{acsTestMessage ? <span className="evg-muted"> — {acsTestMessage}</span> : null}
				</div>
			) : null}
			<p>
				<Link className="evg-btn evg-btn--link" to={SP_CONNECTION_ROUTE_PREFIX}>
					Back to list
				</Link>
			</p>
		</section>
	);
}
