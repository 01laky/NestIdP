#!/usr/bin/env node
/**
 * Minimal mock identity API for local NestIdP development (proposal §7.2).
 * Usage: node docs/examples/mock-identity-api.mjs
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_IDENTITY_PORT ?? 4001);
const TOKEN = process.env.MOCK_IDENTITY_TOKEN ?? 'test-token';

const USERS = [
	{
		id: 'usr_001',
		username: 'jdoe',
		email: 'jdoe@example.com',
		displayName: 'John Doe',
		passwordHash: '$2b$12$test.hash.for.integration.tests.only',
		passwordHashAlgorithm: 'bcrypt',
		active: true,
	},
	{
		id: 'usr_002',
		username: 'inactive',
		email: 'inactive@example.com',
		displayName: 'Inactive User',
		passwordHash: '$2b$12$test.hash.for.integration.tests.only',
		passwordHashAlgorithm: 'bcrypt',
		active: false,
	},
];

const GROUPS = {
	usr_001: [
		{ id: 'grp_001', name: 'developers' },
		{ id: 'grp_002', name: 'admins' },
	],
	usr_002: [],
};

const ROLES = {
	usr_001: [
		{ id: 'role_001', name: 'editor' },
		{ id: 'role_002', name: 'viewer' },
	],
	usr_002: [],
};

function sendJson(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
	const auth = req.headers.authorization ?? '';
	if (auth !== `Bearer ${TOKEN}`) {
		sendJson(res, 401, { message: 'Unauthorized' });
		return;
	}

	const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
	const parts = url.pathname.split('/').filter(Boolean);

	if (req.method === 'GET' && parts.length === 1 && parts[0] === 'users') {
		sendJson(res, 200, USERS);
		return;
	}

	if (
		req.method === 'GET' &&
		parts.length === 3 &&
		parts[0] === 'users' &&
		parts[2] === 'groups'
	) {
		const userId = decodeURIComponent(parts[1]);
		sendJson(res, 200, GROUPS[userId] ?? []);
		return;
	}

	if (
		req.method === 'GET' &&
		parts.length === 3 &&
		parts[0] === 'users' &&
		parts[2] === 'roles'
	) {
		const userId = decodeURIComponent(parts[1]);
		sendJson(res, 200, ROLES[userId] ?? []);
		return;
	}

	sendJson(res, 404, { message: 'Not found' });
});

server.listen(PORT, () => {
	console.log(`Mock identity API listening on http://localhost:${PORT}`);
	console.log(`Bearer token: ${TOKEN}`);
});
