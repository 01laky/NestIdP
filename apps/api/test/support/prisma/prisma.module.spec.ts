import { Test } from '@nestjs/testing';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PrismaService } from '@api/prisma/services/prisma.service';

/**
 * Regression guard: in a production build (emitDecoratorMetadata) the typed `options` constructor
 * parameter compiles to `design:paramtypes = [Object]`, which Nest tries to inject. Without
 * `@Optional()` this throws "Nest can't resolve dependencies of the PrismaService" at boot — caught
 * only by the real app (e2e mocks PrismaService). This test resolves the real provider through Nest's
 * DI exactly as the app does.
 */
describe('PrismaModule DI', () => {
	const previousUrl = process.env.DATABASE_URL;

	beforeAll(() => {
		process.env.DATABASE_URL = 'file:./prisma/.di-guard.db';
	});
	afterAll(() => {
		process.env.DATABASE_URL = previousUrl;
	});

	it('PRISMA-DI-01: Nest can construct PrismaService with no injected args', async () => {
		// .compile() throws "Nest can't resolve dependencies of the PrismaService" if @Optional() is
		// missing — resolving it here is the regression guard.
		const moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
		const prisma = moduleRef.get(PrismaService);
		expect(prisma).toBeDefined();
		expect(typeof prisma.pingDatabase).toBe('function');
		expect(typeof prisma.appliedMigrationCount).toBe('function');
		await moduleRef.close();
	});
});
