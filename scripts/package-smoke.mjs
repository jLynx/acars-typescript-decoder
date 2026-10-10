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
for (const filename of [
	'README.md',
	'LICENSE',
	'THIRD_PARTY_NOTICES.txt',
	'CONTRIBUTING.md',
	'docs/coverage.md',
	'docs/completion-roadmap.md',
	'docs/upstreams.json',
	'docs/MIT-LICENSE.txt',
]) {
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
assert.equal(published.license, 'GPL-3.0-or-later');
assert.equal(published.private, undefined);
assert.equal(published.repository.type, 'git');
assert.equal(published.repository.url, 'git+https://github.com/jLynx/acars-typescript-decoder.git');
assert.equal(published.homepage, 'https://github.com/jLynx/acars-typescript-decoder#readme');
assert.equal(published.bugs.url, 'https://github.com/jLynx/acars-typescript-decoder/issues');
assert.equal(published.author.name, 'jLynx');
assert.equal(published.publishConfig.access, 'public');
assert.equal(published.publishConfig.registry, 'https://registry.npmjs.org/');
assert.equal(published.bin['acars-decode'], './dist/cli.js');
assert((await readFile(path.join(installed, 'dist/cli.js'), 'utf8')).startsWith('#!/usr/bin/env node'));
assert((await readdir(path.join(temporary, 'node_modules/.bin'))).some((name) => name.startsWith('acars-decode')));
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
import { decode, decodeLog, createDecoder, createDecoderSession, decodeAvlc, adaptReceiverRecord, decodeFrame, createX25Reassembler, createClnpReassembler, decodeClnp, decodeEsis, decodeCotp } from '@jlynx_/acars-decoder';
import { createClnpReassembler as framingClnpReassembler, createCotpReassembler, createCotpSession } from '@jlynx_/acars-decoder/framing';
import { createCotpSession as mainCotpSession } from '@jlynx_/acars-decoder';
import { decodeRtr } from '@jlynx_/acars-decoder';
import { decodeRtr as formatsRtr } from '@jlynx_/acars-decoder/formats';
import { airportName } from '@jlynx_/acars-decoder/airports';
import { Bits } from '@jlynx_/acars-decoder/formats';
import * as transportApis from '@jlynx_/acars-decoder/framing';
import * as mainApis from '@jlynx_/acars-decoder';
for (const api of [transportApis, mainApis]) {
 const compressed = api.createClnpCompressedReassembler();
 assert.deepEqual(compressed.stats(), {contexts:0,assemblies:0,bytes:0});
 assert.equal(typeof compressed.observe, 'function');
 assert.deepEqual(api.createHfdlSystemTableAssembler().stats(), {sets:0,bytes:0,sources:0});
 assert.equal(api.isHfdlTableNewer(0, 4095), true);
 assert.deepEqual(api.createAeroReassembler().stats(), {messages:0,bytes:0});
 assert.throws(() => api.decodeAeroSignalUnit(new Uint8Array(), 'R'));
 assert.equal(api.decodeAtnSecurityLabel(Uint8Array.of(0,4,1,15,1,0x21)).tags[0].traffic.category, 'AOC');
 const xid = api.decodeXid(Uint8Array.of(0x82,0xf0,0,6,1,1,2,3,1,0x53));
 assert.deepEqual(xid.groups[0].parameters[1].sequencing, {sequence:3,retry:5});
}
assert.equal(decode({ label: 'Q0', text: '' }).coverage, 'decoded');
assert.deepEqual(decodeLog([]), []);
assert.equal(createDecoder({ airportLookup: airportName }).decode({ label: '5D', text: 'NZAA' }).fields[0].value, 'NZAA · Auckland International Airport');
assert.equal(new Bits(Uint8Array.of(128)).read(1), 1);
const rtrXml = '<RTR><HEAD><TID>TEST</TID></HEAD><HEADRTR><FROM>NZAA</FROM></HEADRTR></RTR>';
for (const reader of [decodeRtr, formatsRtr]) {
 assert.equal(reader(rtrXml).fields[0].value, 'TEST');
 assert.equal(reader(rtrXml).integrity, 'unverified');
}
assert.equal(decode({label:'H1',text:'#CFB'+rtrXml}).maintenance.raw, rtrXml);
assert.equal(decodeFrame(new Uint8Array()), undefined);
assert.equal(createDecoderSession().push({label:'Q0',text:''}).interpretation.coverage, 'decoded');
assert.equal(adaptReceiverRecord({label:'Q0',text:''}).message.label, 'Q0');
assert.throws(() => decodeAvlc(new Uint8Array()));
assert.equal(createX25Reassembler().push(Uint8Array.of(0x10, 1, 0, 9), {link:'test',receivedAt:0}).status, 'complete');
assert.equal(decodeClnp(new Uint8Array()), undefined);
assert.equal(decodeEsis(new Uint8Array()), undefined);
assert.deepEqual(createClnpReassembler().stats(), {assemblies:0,bytes:0});
assert.deepEqual(framingClnpReassembler().stats(), {assemblies:0,bytes:0});
const cotp = createCotpReassembler();
cotp.open({link:'test',destinationReference:1,sourceReference:2,format:'normal',expedited:{}},0);
assert.deepEqual(cotp.stats(), {connections:1,bytes:0});
assert.equal(cotp.push(Uint8Array.of(4,0xf0,0,1,0x80),{link:'test',receivedAt:0}).assemblies[0].status, 'failed');
assert.equal(decodeCotp(Uint8Array.of(4,0xf0,0,1,0x80)).pdus[0].integrity, 'unverified');
for (const transport of [createCotpSession(), mainCotpSession()]) {
 assert.deepEqual(transport.stats(), {pending:0,established:0,frozen:0,bytes:0});
 assert.equal(transport.push(Uint8Array.of(10,227,0,0,0,11,64,195,2,17,239), {link:'test',direction:'a-to-b',receivedAt:0}).events[0].status, 'requested');
 assert.equal(transport.push(Uint8Array.of(10,211,0,11,0,22,64,195,2,29,221), {link:'test',direction:'b-to-a',receivedAt:1}).events[0].status, 'established');
 assert.deepEqual(transport.push(Uint8Array.of(8,240,0,22,128,195,2,112,51,7), {link:'test',direction:'a-to-b',receivedAt:2}).assemblies[0].payload, Uint8Array.of(7));
 transport.reset();
 assert.equal(transport.stats().established, 0);
 const preferredCr = Uint8Array.of(16,227,0,0,0,11,64,240,1,3,192,1,7,195,2,30,31);
 const preferredCc = Uint8Array.of(13,211,0,11,0,22,64,240,1,3,195,2,129,129);
 const size = decodeCotp(preferredCr).pdus[0].parameters.find(part => part.id === 0xf0);
 assert.equal(size.value, 384);
 assert.equal(size.unit, 'bytes');
 assert.equal(transport.push(preferredCr, {link:'test',direction:'a-to-b',receivedAt:0}).events[0].status, 'requested');
 assert.equal(transport.push(preferredCc, {link:'test',direction:'b-to-a',receivedAt:1}).events[0].negotiation.tpduSize, 384);
 transport.reset();
 const cr = Uint8Array.of(27,227,0,0,0,11,64,133,2,1,2,242,4,0,0,1,0,240,2,2,0,198,1,33,195,2,121,22);
 const cc = Uint8Array.of(27,211,0,11,0,22,64,133,2,0,3,242,4,0,0,2,0,240,2,2,0,198,1,33,195,2,20,116);
 transport.push(cr, {link:'test',direction:'a-to-b',receivedAt:0});
 const selected = transport.push(cc, {link:'test',direction:'b-to-a',receivedAt:1}).events[0].negotiation;
 assert.equal(selected.requestAcknowledgement, true);
 assert.equal(selected.initiatorTiming.acknowledgementMs, 258);
 assert.equal(selected.responderTiming.inactivityMs, 512);
 const ak = transport.push(Uint8Array.of(8,99,0,11,1,195,2,125,69), {link:'test',direction:'b-to-a',receivedAt:2}).events[0];
 assert.equal(ak.acknowledgement.window.lower, 1);
 assert.equal(ak.acknowledgement.dataObserved, false);
 transport.push(Uint8Array.of(8,16,0,22,128,195,2,151,235,8), {link:'test',direction:'a-to-b',receivedAt:3});
 assert.equal(transport.push(Uint8Array.of(8,32,0,11,0,195,2,88,174), {link:'test',direction:'b-to-a',receivedAt:4}).events[0].status, 'acknowledged');
 assert.equal(transport.push(Uint8Array.of(10,128,0,22,0,11,0,195,2,245,152), {link:'test',direction:'a-to-b',receivedAt:5}).events.at(-1).release.stage, 'requested');
 assert.equal(transport.push(Uint8Array.of(9,192,0,11,0,22,195,2,190,144), {link:'test',direction:'b-to-a',receivedAt:6}).events[0].release.stage, 'confirmed');
}
const largeSession = mainCotpSession({maxNsduBytes:65535});
assert.equal(largeSession.stats().bytes, 0);
assert.equal(decodeCotp(new Uint8Array(65536),{maxNsduBytes:65535}), undefined);
`,
);
command(process.execPath, ['consumer.mjs'], temporary);
await writeFile(
	path.join(temporary, 'consumer.ts'),
	`
import { decode, createDecoder, createDecoderSession, decodeAvlc, adaptReceiverRecord, createX25Reassembler, createClnpReassembler, decodeClnp, decodeEsis, type EsisOptions, type ClnpReassembler, type ClnpAssembly, type ClnpReception, type ClnpReassemblyOptions, type X25Reassembler, type ClnpPdu, type EsisPdu, type DecoderSession, type AvlcFrame, type ReceiverRecord, type AcarsRecord, type AcarsInterpretation } from '@jlynx_/acars-decoder';
import { createClnpReassembler as framingClnpReassembler, createCotpReassembler, type CotpExpeditedOptions, type CotpReassembler, type CotpAssembly, type CotpConnection, type CotpReception, type CotpReassemblyOptions, type CotpReassemblyResult, type ClnpReassembler as FramingClnpReassembler } from '@jlynx_/acars-decoder/framing';
import { createCotpReassembler as mainCotpReassembler } from '@jlynx_/acars-decoder';
import { decodeRtr, type RtrReport, type RtrField } from '@jlynx_/acars-decoder';
import { decodeRtr as formatsRtr, type RtrReport as FormatsRtrReport } from '@jlynx_/acars-decoder/formats';
import { createCotpSession, type CotpSession, type CotpSessionReception, type CotpSessionOptions, type CotpSessionResult, type CotpSessionEvent, type CotpSessionAssembly, type CotpNegotiation, type CotpTiming, type CotpWindow, type CotpAcknowledgement, type CotpRelease, type CotpTransmission } from '@jlynx_/acars-decoder/framing';
import { createCotpSession as mainCotpSession, type CotpSession as MainCotpSession, type CotpSessionReception as MainCotpReception, type CotpSessionAssembly as MainCotpAssembly } from '@jlynx_/acars-decoder';
import { createClnpCompressedReassembler, createAeroReassembler, createHfdlSystemTableAssembler, decodeAtnSecurityLabel, type ClnpCompressedReassembler, type ClnpContextObservation, type AeroReassembler, type AeroControl, type HfdlSystemTableAssembler, type AtnSecurityLabel, type XidParameter } from '@jlynx_/acars-decoder/framing';
import { type AeroControl as MainAeroControl, type ClnpContextObservation as MainContextObservation } from '@jlynx_/acars-decoder';
const compressed: ClnpCompressedReassembler = createClnpCompressedReassembler();
const observe: (bytes: Uint8Array, reception: {link:string;receivedAt:number;linkIntegrity:'verified'}) => ClnpContextObservation = compressed.observe;
const aero: AeroReassembler = createAeroReassembler();
const control: AeroControl | undefined = aero.push(new Uint8Array(), 'R', {link:'a',receivedAt:0,direction:'downlink'}).unit.control;
const mainControl: MainAeroControl | undefined = control;
const mainObservation: MainContextObservation | undefined = undefined;
const tables: HfdlSystemTableAssembler = createHfdlSystemTableAssembler();
const security: AtnSecurityLabel = decodeAtnSecurityLabel(Uint8Array.of(0));
const xidParameter: XidParameter = {id:3,name:'XID sequencing',raw:Uint8Array.of(0x53),sequencing:{sequence:3,retry:5}};
import { airportName } from '@jlynx_/acars-decoder/airports';
import { Bits } from '@jlynx_/acars-decoder/formats';
const result: AcarsInterpretation = decode({ label: 'Q0', text: '' });
const records: AcarsRecord[] = [];
const rtr: RtrReport | undefined = decodeRtr('<RTR><HEAD/><HEADRTR/></RTR>');
const rtrField: RtrField | undefined = rtr?.fields[0];
const formatsReport: FormatsRtrReport | undefined = formatsRtr('<RTR><HEAD/><HEADRTR/></RTR>');
createDecoder({ airportLookup: airportName }).decodeLog(records);
new Bits(new Uint8Array());
const session: DecoderSession = createDecoderSession();
const receiver: ReceiverRecord | undefined = adaptReceiverRecord({label:'Q0',text:''});
const transport: AvlcFrame = decodeAvlc(new Uint8Array());
const assembler: X25Reassembler = createX25Reassembler();
const options: ClnpReassemblyOptions = {maxAssemblies:1,format:'normal'};
const networkAssembler: ClnpReassembler = createClnpReassembler(options);
const framingAssembler: FramingClnpReassembler = framingClnpReassembler();
const cotpOptions: CotpReassemblyOptions = {windowSize:32,maxBytes:65536};
const cotp: CotpReassembler = createCotpReassembler(cotpOptions);
const mainCotp: CotpReassembler = mainCotpReassembler();
const expedited: CotpExpeditedOptions = {startSequence:0};
const connection: CotpConnection = {link:'test',destinationReference:1,sourceReference:2,format:'normal',expedited};
const esisOptions: EsisOptions = {eshFormat:'address-list'};
const cotpReception: CotpReception = {link:'test',receivedAt:0};
cotp.open(connection,0);
const cotpResult: CotpReassemblyResult = cotp.push(new Uint8Array(), cotpReception);
const cotpAssembly: CotpAssembly | undefined = cotpResult.assemblies[0];
const passiveOptions: CotpSessionOptions = {maxRecords:64,freezeMs:60000,maxNsduBytes:65535};
const passive: CotpSession = createCotpSession(passiveOptions);
const mainPassive: MainCotpSession = mainCotpSession();
const passiveReception: CotpSessionReception = {link:'test',direction:'a-to-b',receivedAt:0};
const mainReception: MainCotpReception = passiveReception;
const passiveResult: CotpSessionResult = passive.push(Uint8Array.of(4,0xf0,0,1,0x80),mainReception);
const passiveEvent: CotpSessionEvent | undefined = passiveResult.events[0];
const negotiation: CotpNegotiation | undefined = passiveEvent?.negotiation;
const timing: CotpTiming | undefined = negotiation?.initiatorTiming;
const acknowledged: CotpAcknowledgement | undefined = passiveEvent?.acknowledgement;
const window: CotpWindow | undefined = acknowledged?.window;
const release: CotpRelease | undefined = passiveEvent?.release;
const passiveAssembly: CotpSessionAssembly | undefined = passiveResult.assemblies[0];
const transmission: CotpTransmission | undefined = passiveAssembly?.transmission;
const mainAssembly: MainCotpAssembly | undefined = passiveAssembly;
const reception: ClnpReception = {link:'test',receivedAt:0};
const assembly: ClnpAssembly = networkAssembler.push(new Uint8Array(), reception);
const clnp: ClnpPdu | undefined = decodeClnp(new Uint8Array());
const esis: EsisPdu | undefined = decodeEsis(new Uint8Array(), esisOptions);
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
await writeFile(
	entry,
	"import { decode, decodeRtr } from '@jlynx_/acars-decoder'; console.log(decode({label:'Q0',text:''}), decodeRtr('<RTR><HEAD/><HEADRTR/></RTR>'));",
);
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
assert(
	!Object.keys(bundled.metafile.inputs).some((name) => /cli\.js/.test(name)),
	'Browser imports must exclude the CLI',
);
await writeFile(
	entry,
	"import { AcarsFramer, createClnpReassembler, createCotpReassembler, createCotpSession, createClnpCompressedReassembler, createAeroReassembler, createHfdlSystemTableAssembler, decodeAtnSecurityLabel } from '@jlynx_/acars-decoder/framing'; console.log(AcarsFramer, createClnpReassembler().stats(), createCotpReassembler().stats(), createCotpSession().stats(), createClnpCompressedReassembler().stats(), createAeroReassembler().stats(), createHfdlSystemTableAssembler().stats(), decodeAtnSecurityLabel(Uint8Array.of(0)));",
);
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
await import('./upstream/replay-smoke.mjs').then(({ replaySmoke }) => replaySmoke(installed, temporary));
console.log(
	'Packed package passed metadata, documentation, clean Node runtime, NodeNext TypeScript and browser bundle checks.',
);
console.log(`Consumer artifacts: ${temporary}`);
