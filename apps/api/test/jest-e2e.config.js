/** @type {import('jest').Config} */
module.exports = {
	moduleFileExtensions: ['js', 'json', 'ts'],
	rootDir: '.',
	testEnvironment: 'node',
	testRegex: '.e2e-spec.ts$',
	setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
	transform: {
		'^.+\\.(t|j)s$': [
			'ts-jest',
			{
				tsconfig: '<rootDir>/../tsconfig.test.json',
			},
		],
	},
	moduleNameMapper: {
		'^@nestidp/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
		'^@api/(.*)$': '<rootDir>/../src/$1',
		'^@test/(.*)$': '<rootDir>/$1',
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
};
