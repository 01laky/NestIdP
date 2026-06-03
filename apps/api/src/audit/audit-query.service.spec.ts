import { AUDIT_EXPORT_MAX_ROWS } from '@nestidp/shared';
import { AuditQueryService } from './audit-query.service';

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
				event: 'probe',
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
				event: 'csv_escape_probe',
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
			'createdAt,category,event,actorType,actorLabel,subjectType,subjectId,clientIp,metadata',
		);
	});
});
