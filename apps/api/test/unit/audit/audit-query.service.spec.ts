import { AUDIT_EXPORT_MAX_ROWS } from '@nestidp/shared';
import { AuditQueryService } from '@api/audit/services/audit-query.service';

describe('AuditQueryService', () => {
	const prisma = {
		auditEvent: {
			findMany: jest.fn(),
			count: jest.fn(),
		},
	};
	let service: AuditQueryService;

	beforeEach(() => {
		jest.clearAllMocks();
		service = new AuditQueryService(prisma as never);
	});

	it('API-AUD-QRY-01: list defaults limit 50 and offset 0', async () => {
		prisma.auditEvent.findMany.mockResolvedValue([]);
		prisma.auditEvent.count.mockResolvedValue(0);

		const result = await service.list({});

		expect(result.limit).toBe(50);
		expect(result.offset).toBe(0);
		expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 50, skip: 0 }),
		);
	});

	it('API-AUD-QRY-02: list applies category and event filters', async () => {
		prisma.auditEvent.findMany.mockResolvedValue([]);
		prisma.auditEvent.count.mockResolvedValue(0);

		await service.list({ category: 'saml', event: 'saml_request_received', limit: 10, offset: 5 });

		expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { category: 'saml', event: 'saml_request_received' },
				take: 10,
				skip: 5,
			}),
		);
	});

	it('API-AUD-QRY-03: list since/until build createdAt range', async () => {
		prisma.auditEvent.findMany.mockResolvedValue([]);
		prisma.auditEvent.count.mockResolvedValue(0);

		await service.list({
			since: '2026-01-01T00:00:00.000Z',
			until: '2026-12-31T23:59:59.999Z',
		});

		const where = prisma.auditEvent.findMany.mock.calls[0][0].where;
		expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
		expect(where.createdAt.lte).toEqual(new Date('2026-12-31T23:59:59.999Z'));
	});

	it('API-AUD-QRY-04: exportJson sets truncated when at export cap', async () => {
		prisma.auditEvent.findMany.mockResolvedValue(
			Array.from({ length: AUDIT_EXPORT_MAX_ROWS }, (_, index) => ({
				id: `e-${index}`,
				category: 'admin_auth',
				event: 'probe' as never,
				actorType: 'admin',
				actorId: null,
				actorLabel: null,
				subjectType: null,
				subjectId: null,
				clientIp: null,
				metadata: null,
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
			})),
		);

		const body = await service.exportJson({});
		expect(body.truncated).toBe(true);
		expect(body.items).toHaveLength(AUDIT_EXPORT_MAX_ROWS);
	});

	it('API-AUD-QRY-05: exportJson not truncated below cap', async () => {
		prisma.auditEvent.findMany.mockResolvedValue([]);
		const body = await service.exportJson({ category: 'sync' });
		expect(body.truncated).toBe(false);
		expect(body.filters.category).toBe('sync');
	});

	it('API-AUD-QRY-06: exportCsv escapes double quotes in metadata', async () => {
		prisma.auditEvent.findMany.mockResolvedValue([
			{
				id: 'e1',
				category: 'admin_config',
				event: 'csv_escape_probe' as never,
				actorType: 'admin',
				actorId: 'a1',
				actorLabel: 'admin',
				subjectType: null,
				subjectId: null,
				clientIp: null,
				metadata: { note: 'say "hello"' },
				createdAt: new Date('2026-06-01T12:00:00.000Z'),
			},
		]);

		const csv = await service.exportCsv({});
		expect(csv).toMatch(/note.*hello/);
		expect(csv).toContain('""');
		expect(csv.split('\n')[0]).toBe(
			'id,createdAt,category,event,actorType,actorLabel,subjectType,subjectId,clientIp,metadata',
		);
	});

	it('API-AUD-QRY-07: exportCsv neutralises spreadsheet formula injection + includes id (§5.A11)', async () => {
		prisma.auditEvent.findMany.mockResolvedValue([
			{
				id: 'e7',
				category: 'admin_auth',
				event: 'login_failure' as never,
				actorType: 'admin',
				actorId: null,
				// attacker-chosen username that begins with `=` (a formula trigger in Excel/Sheets)
				actorLabel: '=cmd|/c calc',
				subjectType: null,
				subjectId: '+SUM(A1:A9)',
				clientIp: null,
				metadata: null,
				createdAt: new Date('2026-06-01T12:00:00.000Z'),
			},
		]);

		const csv = await service.exportCsv({});
		const dataRow = csv.split('\n')[1];
		// the formula cells are prefixed with a single quote so the cell is treated as text
		expect(dataRow).toContain(`"'=cmd|/c calc"`);
		expect(dataRow).toContain(`"'+SUM(A1:A9)"`);
		// id column present and first
		expect(dataRow.startsWith('"e7"')).toBe(true);
	});
});
