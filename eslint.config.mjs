import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier/flat';
import imports from './scripts/lint/source-alias.mjs';
import architecture from './scripts/lint/type-files.mjs';

export default defineConfig(
	globalIgnores(['dist/**', 'coverage/**', 'test-results/**']),
	{
		files: ['**/*.{js,mjs,ts}'],
		extends: [js.configs.recommended],
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		languageOptions: { globals: { ...globals.node, ...globals.browser } },
		rules: {
			'no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'prefer-const': 'error',
			'no-var': 'error',
			eqeqeq: ['error', 'always', { null: 'ignore' }],
		},
	},
	{
		files: ['src/**/*.ts', '*config.ts'],
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{ prefer: 'type-imports', fixStyle: 'inline-type-imports' },
			],
			'@typescript-eslint/no-import-type-side-effects': 'error',
			'@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{ 'ts-ignore': true, 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 },
			],
			'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
			complexity: ['error', 20],
		},
	},
	{ files: ['src/**/*.ts', 'test/**/*.{js,ts}'], plugins: { imports }, rules: { 'imports/source-alias': 'error' } },
	{ files: ['src/**/*.ts'], plugins: { architecture }, rules: { 'architecture/type-files': 'error' } },
	{ files: ['test/**/*.ts'], extends: [tseslint.configs.recommended] },
	prettier,
);
