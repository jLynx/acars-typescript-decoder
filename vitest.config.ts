import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
	test: {
		include: ['test/**/*.spec.{js,ts}'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/types.ts'],
			reporter: ['text', 'html', 'json-summary'],
		},
	},
});
