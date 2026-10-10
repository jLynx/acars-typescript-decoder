import { build } from 'esbuild';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

// Clear only this package's resolved output directory so old split chunks cannot ship.
const output = path.resolve('dist');
if (output !== path.join(process.cwd(), 'dist')) throw new Error('Unexpected build output path');
await rm(output, { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
	entryPoints: ['src/index.ts', 'src/airports.ts', 'src/formats.ts', 'src/framing.ts'],
	outdir: 'dist',
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	target: 'es2022',
	packages: 'external',
	sourcemap: true,
	splitting: true,
	tsconfig: 'tsconfig.json',
});
for (const entry of ['index', 'airports', 'formats', 'framing']) {
	const bundle = await rollup({ input: `src/${entry}.ts`, plugins: [dts({ tsconfig: 'tsconfig.json' })] });
	await bundle.write({ file: `dist/${entry}.d.ts`, format: 'es' });
	await bundle.close();
}
