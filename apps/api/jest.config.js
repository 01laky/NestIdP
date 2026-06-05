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
	testEnvironment: 'node',
	setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
	moduleNameMapper: {
		'^@nestidp/shared$': '<rootDir>/../../packages/shared/src/index.ts',
		'^@api/(.*)$': '<rootDir>/src/$1',
		'^@test/(.*)$': '<rootDir>/test/$1',
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
};
