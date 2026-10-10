import fs from 'node:fs/promises';
import { MessageDecoder } from '@airframes/acars-decoder';
import { decode } from '../../dist/index.js';
import { interpretCommunity } from '../../dist/formats.js';
import { compareFields } from './fields.mjs';

// Compare public fixtures through our public dispatcher as well as its Airframes adapter.
const corpus = JSON.parse(await fs.readFile('test/upstream/airframes.json', 'utf8'));
const upstream = new MessageDecoder();
const rows = [];
for (const fixture of corpus.cases.filter((item) => item.plugin)) {
	const reference = upstream.plugins
		.find((plugin) => plugin.name === fixture.plugin)
		.decode(structuredClone(fixture.input));
	const record = {
		...fixture.input,
		id: 1,
		receivedAt: 1791576000000,
		registration: 'TEST',
		mode: '2',
		acknowledgement: '',
		blockId: '1',
		direction: 'downlink',
		continuation: false,
	};
	const actual = decode(record);
	const adapter = interpretCommunity(record);
	const expected = (reference.formatted?.items ?? []).filter(
		(item) => item.value && item.value !== 'Unknown' && !/unknown/i.test(item.type) && !/NaN|Infinity/.test(item.value),
	);
	const comparisons = compareFields(expected, actual, fixture.input);
	rows.push({
		file: fixture.file,
		name: fixture.name,
		input: fixture.input,
		referenceDecoded: reference.decoded,
		coverage: actual.coverage,
		adapterCoverage: adapter?.coverage ?? 'unknown',
		comparisons,
		unresolvedFields: comparisons.filter((item) => item.classification === 'unresolved'),
	});
}
await fs.mkdir('test-results/upstream', { recursive: true });
await fs.writeFile(
	'test-results/upstream/comparison.json',
	JSON.stringify({ source: corpus.source, rows }, null, 2) + '\n',
);
console.log(
	JSON.stringify(
		{
			cases: rows.length,
			referenceDecoded: rows.filter((row) => row.referenceDecoded).length,
			decoderRecognized: rows.filter((row) => row.coverage !== 'unknown').length,
			unresolvedCases: rows.filter((row) => row.unresolvedFields.length).length,
			classifications: rows
				.flatMap((row) => row.comparisons)
				.reduce((counts, item) => {
					counts[item.classification] = (counts[item.classification] ?? 0) + 1;
					return counts;
				}, {}),
			output: 'test-results/upstream/comparison.json',
		},
		null,
		2,
	),
);
