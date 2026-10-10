import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Confirm imported test bytes against the exact public revision, without executing downloaded code.
const corpus = process.argv[2] ?? 'airframes';
if (!['airframes', 'datalink'].includes(corpus)) throw new Error('Use airframes or datalink');
const data = JSON.parse(await fs.readFile(`test/upstream/${corpus}.json`, 'utf8'));
const root = process.argv[3];
if (!root) throw new Error('Supply the downloaded snapshot path');
const repository = data.source.repository.replace('https://github.com/', '');
const files = data.inventory
	.filter((entry) => entry.sha256)
	.map((entry) => ({
		...entry,
		path: corpus === 'airframes' ? `lib/plugins/${entry.file}` : entry.file,
	}));
let next = 0,
	verified = 0;
await Promise.all(
	Array.from({ length: 4 }, async () => {
		while (next < files.length) {
			const entry = files[next++];
			const response = await fetch(
				`https://raw.githubusercontent.com/${repository}/${data.source.revision}/${entry.path}`,
				{ signal: AbortSignal.timeout(30000) },
			);
			if (!response.ok) throw new Error(`Source unavailable: ${entry.path} (${response.status})`);
			const upstream = Buffer.from(await response.arrayBuffer());
			const local = await fs.readFile(`${root}/${entry.path}`);
			const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
			if (hash(upstream) !== entry.sha256 || hash(local) !== entry.sha256)
				throw new Error(`Source bytes differ: ${entry.path}`);
			verified++;
		}
	}),
);
console.log(`Verified ${verified} imported files against ${repository}@${data.source.revision}.`);
