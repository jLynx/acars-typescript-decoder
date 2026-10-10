import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function replaySmoke(installed, temporary) {
	const cli = path.join(installed, 'dist/cli.js');
	const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });
	assert.equal(run(['--help']).status, 0);
	const input = {
		id: 42,
		receivedAt: 1000,
		label: 'H1',
		text: 'HELLO  ',
		registration: 'TEST',
		mode: '2',
		blockId: '1',
		acknowledgement: 'NAK',
		direction: 'downlink',
		messageNumber: 'M01A',
		flight: 'TEST1',
		continuation: false,
		source: 'normalized',
	};
	const result = run([], JSON.stringify(input) + '\n');
	assert.equal(result.status, 0, result.stderr);
	const decoded = JSON.parse(result.stdout);
	for (const [key, value] of Object.entries(input)) assert.equal(decoded[key], value, key);
	const flat = { label: 'Q0', text: '', timestamp: 1.5, tail: 'TEST', block_id: '1' };
	const nested = { vdl2: { t: { sec: 2, usec: 3000 }, avlc: { acars: { label: 'Q0', msg_text: '', blk_id: 'A' } } } };
	const jsonl = [flat, nested].map((item) => JSON.stringify(item)).join('\n') + '\n';
	const filename = path.join(temporary, 'receiver.jsonl');
	await writeFile(filename, jsonl);
	const receivers = run([filename]);
	assert.equal(receivers.status, 0, receivers.stderr);
	const messages = receivers.stdout
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	assert.equal(messages[0].receivedAt, 1500);
	assert.equal(messages[1].receivedAt, 2003);
	assert.equal(messages[1].direction, 'uplink');
	assert.equal(messages[1].interpretation.coverage, 'decoded');
	const broken = run([], JSON.stringify(flat) + '\n{invalid}\n');
	assert.equal(broken.status, 1);
	assert.match(broken.stderr, /Line 2:/);
	assert.equal(run([], '{"label":"Q0","text":"' + 'x'.repeat(1_048_577)).status, 1);
	const capture = path.join(temporary, 'capture.json');
	await writeFile(capture, JSON.stringify({ sources: [{ vfoNumber: 1, messages: [input] }] }));
	const replay = run(['--capture', capture]);
	assert.equal(replay.status, 0, replay.stderr);
	assert.equal(JSON.parse(replay.stdout).source, 'vfo:1');
	assert.equal(JSON.parse(replay.stdout).text, input.text);
	const uplink = {
		...input,
		label: '_d',
		text: '',
		direction: 'uplink',
		acknowledgement: '0',
		messageNumber: null,
		flight: null,
	};
	await writeFile(
		capture,
		JSON.stringify({
			sources: [
				{ vfoNumber: 1, messages: [input] },
				{ vfoNumber: 2, messages: [uplink] },
			],
		}),
	);
	const nullable = run(['--capture', capture]);
	assert.equal(nullable.status, 0, nullable.stderr);
	const blocks = nullable.stdout
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].messageNumber, input.messageNumber);
	assert.equal(blocks[0].text, input.text);
	assert.equal(blocks[1].source, 'vfo:2');
	assert.equal(blocks[1].direction, 'uplink');
	assert.equal(blocks[1].interpretation.coverage, 'decoded');
	assert.equal(blocks[1].text, '');
	assert.equal(blocks[1].messageNumber, undefined);
	assert.equal(blocks[1].flight, undefined);
	await writeFile(capture, JSON.stringify({ sources: [{ messages: [{ ...uplink, messageNumber: 123 }] }] }));
	const invalid = run(['--capture', capture]);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /Invalid messageNumber/);
	console.log('Replay CLI passed stdin, JSONL, capture, metadata and malformed input checks.');
}
