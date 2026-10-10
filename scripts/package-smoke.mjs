import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = process.cwd();
// npm's JS entry avoids shell-dependent quoting and .cmd execution on Windows.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package');
function command(executable, args, cwd) {
	const result = spawnSync(executable, args, { cwd, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stdout + result.stderr);
	return result.stdout;
}
const temporary = await mkdtemp(path.join(tmpdir(), 'acars-package-'));
const packed = JSON.parse(
	command(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root),
)[0];
assert(packed.files.some((file) => file.path === 'dist/index.d.ts'));
assert(!packed.files.some((file) => /^(?:test|src|node_modules)\//.test(file.path)));
await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
command(
	process.execPath,
	[npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temporary, packed.filename)],
	temporary,
);
await writeFile(
	path.join(temporary, 'consumer.mjs'),
	`
import assert from 'node:assert/strict';
import { decode, decodeLog, createDecoder, decodeFrame } from 'acars-decoder';
import { airportName } from 'acars-decoder/airports';
import { Bits } from 'acars-decoder/formats';
assert.equal(decode({ label: 'Q0', text: '' }).coverage, 'decoded');
assert.deepEqual(decodeLog([]), []);
assert.equal(createDecoder({ airportLookup: airportName }).decode({ label: '5D', text: 'NZAA' }).fields[0].value, 'NZAA · Auckland International Airport');
assert.equal(new Bits(Uint8Array.of(128)).read(1), 1);
assert.equal(decodeFrame(new Uint8Array()), undefined);
`,
);
command(process.execPath, ['consumer.mjs'], temporary);
await writeFile(
	path.join(temporary, 'consumer.ts'),
	`
import { decode, createDecoder, type AcarsRecord, type AcarsInterpretation } from 'acars-decoder';
import { airportName } from 'acars-decoder/airports';
import { Bits } from 'acars-decoder/formats';
const result: AcarsInterpretation = decode({ label: 'Q0', text: '' });
const records: AcarsRecord[] = [];
createDecoder({ airportLookup: airportName }).decodeLog(records);
new Bits(new Uint8Array());
console.log(result.title);
`,
);
command(
	process.execPath,
	[
		path.join(root, 'node_modules/typescript/bin/tsc'),
		'--noEmit',
		'--strict',
		'--skipLibCheck',
		'--module',
		'NodeNext',
		'--moduleResolution',
		'NodeNext',
		'--target',
		'ES2022',
		'consumer.ts',
	],
	temporary,
);
const entry = path.join(temporary, 'browser.ts');
await writeFile(entry, "import { decode } from 'acars-decoder'; console.log(decode({label:'Q0',text:''}));");
const { build } = await import('esbuild');
const bundled = await build({
	entryPoints: [entry],
	bundle: true,
	platform: 'browser',
	format: 'esm',
	write: false,
	metafile: true,
});
assert(
	!Object.keys(bundled.metafile.inputs).some((name) => /airports\.json/.test(name)),
	'Main import must not bundle optional airport dataset',
);
await writeFile(entry, "import { AcarsFramer } from 'acars-decoder/framing'; console.log(AcarsFramer);");
const framing = await build({
	entryPoints: [entry],
	bundle: true,
	platform: 'browser',
	format: 'esm',
	write: false,
	metafile: true,
});
assert(
	!Object.keys(framing.metafile.inputs).some((name) => /airframes|pako|airports/.test(name)),
	'Framing import must remain independent from application decoders',
);
const distribution = path.join(temporary, 'node_modules/acars-decoder/dist');
for (const filename of await readdir(distribution)) {
	if (!filename.endsWith('.d.ts')) continue;
	assert(
		!(await readFile(path.join(distribution, filename), 'utf8')).includes("'@/"),
		'Declarations must resolve without source aliases',
	);
}
console.log('Packed package passed clean Node runtime, NodeNext TypeScript and browser bundle checks.');
console.log(`Consumer artifacts: ${temporary}`);
