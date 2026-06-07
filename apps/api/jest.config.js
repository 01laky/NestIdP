/** @type {import('jest').Config} */
module.exports = {
	moduleFileExtensions: ['js', 'json', 'ts'],
	rootDir: '.',
	roots: ['<rootDir>/test/unit', '<rootDir>/test/support'],
	testRegex: '.*\\.spec\\.ts$',
	transform: {
		'^.+\\.(t|j)s$': [
			'ts-jest',
			{
				tsconfig: '<rootDir>/tsconfig.test.json',
			},
		],
	},
	collectCoverageFrom: ['src/**/*.(t|j)s'],
	coverageDirectory: 'coverage',
	// Integration specs apply the full migration history to a fresh libSQL file each run; under load
	// (CI / serial --runInBand) that can exceed Jest's 60s default, so allow a safe margin.
	testTimeout: 120_000,
	testEnvironment: 'node',
	setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
	moduleNameMapper: {
		'^@nestidp/shared$': '<rootDir>/../../packages/shared/src/index.ts',
		'^@api/(.*)$': '<rootDir>/src/$1',
		'^@test/(.*)$': '<rootDir>/test/$1',
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
};
