import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = process.cwd();
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
// npm's JS entry avoids shell-dependent quoting and .cmd execution on Windows.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package');
function command(executable, args, cwd) {
	const result = spawnSync(executable, args, { cwd, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stdout + result.stderr);
	return result.stdout;
}
const temporary = await mkdtemp(path.join(tmpdir(), 'acars-package-'));
// An outer pack/publish preview passes dry-run through the lifecycle environment.
// These commands must create and install a real tarball locally to validate it.
const packing = JSON.parse(
	command(
		process.execPath,
		[npm, 'pack', '--ignore-scripts', '--dry-run=false', '--json', '--pack-destination', temporary],
		root,
	),
);
// npm 11 returns an array; npm 12 returns an object keyed by package name.
const packed = Array.isArray(packing) ? packing[0] : packing[metadata.name];
assert(packed && Array.isArray(packed.files), 'npm pack must return package file metadata');
assert(packed.files.some((file) => file.path === 'dist/index.d.ts'));
assert(!packed.files.some((file) => /^(?:test|src|node_modules)\//.test(file.path)));
for (const filename of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'CONTRIBUTING.md', 'docs/releasing.md']) {
	assert(
		packed.files.some((file) => file.path === filename),
		`Missing distribution file: ${filename}`,
	);
}
await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
command(
	process.execPath,
	[
		npm,
		'install',
		'--ignore-scripts',
		'--dry-run=false',
		'--no-audit',
		'--no-fund',
		path.join(temporary, packed.filename),
	],
	temporary,
);
const installed = path.join(temporary, 'node_modules/@jlynx_/acars-decoder');
const published = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
assert.equal(published.name, '@jlynx_/acars-decoder');
assert.equal(published.version, metadata.version);
assert.equal(published.license, 'MIT');
assert.equal(published.private, undefined);
assert.equal(published.repository.type, 'git');
assert.equal(published.repository.url, 'git+https://github.com/jLynx/acars-typescript-decoder.git');
assert.equal(published.homepage, 'https://github.com/jLynx/acars-typescript-decoder#readme');
assert.equal(published.bugs.url, 'https://github.com/jLynx/acars-typescript-decoder/issues');
assert.equal(published.author.name, 'jLynx');
assert.equal(published.publishConfig.access, 'public');
assert.equal(published.publishConfig.registry, 'https://registry.npmjs.org/');
for (const filename of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
	assert.equal(
		await readFile(path.join(installed, filename), 'utf8'),
		await readFile(path.join(root, filename), 'utf8'),
	);
}
for (const entry of Object.values(published.exports)) {
	for (const filename of Object.values(entry)) {
		assert(
			packed.files.some((file) => file.path === filename.replace(/^\.\//, '')),
			`Missing export: ${filename}`,
		);
	}
}
await writeFile(
	path.join(temporary, 'consumer.mjs'),
	`
import assert from 'node:assert/strict';
import { decode, decodeLog, createDecoder, decodeFrame } from '@jlynx_/acars-decoder';
import { airportName } from '@jlynx_/acars-decoder/airports';
import { Bits } from '@jlynx_/acars-decoder/formats';
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
import { decode, createDecoder, type AcarsRecord, type AcarsInterpretation } from '@jlynx_/acars-decoder';
import { airportName } from '@jlynx_/acars-decoder/airports';
import { Bits } from '@jlynx_/acars-decoder/formats';
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
		path.join(root, 'node_modules/@typescript/native/bin/tsc'),
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
await writeFile(entry, "import { decode } from '@jlynx_/acars-decoder'; console.log(decode({label:'Q0',text:''}));");
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
await writeFile(entry, "import { AcarsFramer } from '@jlynx_/acars-decoder/framing'; console.log(AcarsFramer);");
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
const distribution = path.join(temporary, 'node_modules/@jlynx_/acars-decoder/dist');
for (const filename of await readdir(distribution)) {
	if (!filename.endsWith('.d.ts')) continue;
	assert(
		!(await readFile(path.join(distribution, filename), 'utf8')).includes("'@/"),
		'Declarations must resolve without source aliases',
	);
}
console.log(
	'Packed package passed metadata, documentation, clean Node runtime, NodeNext TypeScript and browser bundle checks.',
);
console.log(`Consumer artifacts: ${temporary}`);
