import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { format, resolveConfig } from 'prettier';

// Copy only JSON data and its license. Never evaluate downloaded upstream code.
const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/upstream/datalink.mjs <pinned datalink snapshot>');
const manifest = JSON.parse(await fs.readFile('docs/upstreams.json', 'utf8'));
const source = manifest.sources.find((item) => item.id === 'datalink');
const files = ['acars_extraction.jsonl', 'acars_payloads.jsonl', 'adsc.jsonl', 'cpdlc.jsonl'];
const inventory = [],
	fixtures = {};
for (const file of files) {
	const relative = `crates/acars/tests/fixtures/${file}`;
	const text = await fs.readFile(path.join(root, relative), 'utf8');
	fixtures[file.replace('.jsonl', '')] = text
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
	inventory.push({ file: relative, sha256: crypto.createHash('sha256').update(text).digest('hex') });
}
await fs.copyFile(path.join(root, 'license.md'), 'test/upstream/datalink.license.txt');
await fs.writeFile(
	'test/upstream/datalink.json',
	await format(JSON.stringify({ source, inventory, fixtures }), {
		...(await resolveConfig('test/upstream/datalink.json')),
		parser: 'json',
	}),
);
console.log(`Imported ${Object.values(fixtures).reduce((sum, rows) => sum + rows.length, 0)} licensed Rust fixtures.`);
