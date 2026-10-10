import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { decode, createDecoderSession } from '../dist/index.js';

const corpus = JSON.parse(await readFile('test/upstream/airframes.json', 'utf8'))
	.cases.filter((fixture) => fixture.plugin)
	.map((fixture) => fixture.input);
for (const input of corpus) decode(input);
const iterations = 20000;
const start = performance.now();
for (let index = 0; index < iterations; index++) decode(corpus[index % corpus.length]);
const elapsed = performance.now() - start;
// Distinct whitespace suffixes force new cache keys without changing input length.
// This synthetic workload measures parser/cache-miss cost, not a representative radio stream.
const coldIterations = 5000;
const coldStart = performance.now();
for (let index = 0; index < coldIterations; index++) {
	const input = corpus[index % corpus.length];
	const suffix = index.toString(2).padStart(16, '0').replaceAll('0', ' ').replaceAll('1', '\t');
	decode({ ...input, text: input.text + suffix });
}
const coldElapsed = performance.now() - coldStart;
const session = createDecoderSession();
const streamStart = performance.now();
for (let index = 0; index < 1000; index++)
	session.push({ ...corpus[index % corpus.length], registration: 'TEST', receivedAt: index * 1000 });
console.log(
	JSON.stringify(
		{
			node: process.version,
			corpus: corpus.length,
			cachedCorpus: { iterations, elapsedMs: elapsed, messagesPerSecond: Math.round((iterations * 1000) / elapsed) },
			syntheticCacheMisses: {
				iterations: coldIterations,
				elapsedMs: coldElapsed,
				messagesPerSecond: Math.round((coldIterations * 1000) / coldElapsed),
				workload: 'unique 16-character whitespace suffixes; synthetic corpus variants',
			},
			stream: { messages: 1000, elapsedMs: performance.now() - streamStart, retained: session.stats() },
			memory: process.memoryUsage(),
		},
		null,
		2,
	),
);
