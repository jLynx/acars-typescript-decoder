import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { createDecoderSession, decodeLog } from '@/index';
import { adaptReceiverRecord } from '@/transport/receivers';
import { isRecord } from '@/validation';
import type { AcarsInput, AcarsRecord } from '@/types';

/** Streams bounded JSONL; --capture reads the viewer's grouped-source JSON export. */
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes('--help')) {
		process.stdout.write(
			'Usage: acars-decode [messages.jsonl]\n       acars-decode --capture capture.json\nReads JSONL from stdin when no file is supplied. Writes decoded JSONL to stdout.\n',
		);
		return;
	}
	if (args[0] === '--capture') {
		if (args.length !== 2) throw new Error('--capture requires one JSON filename');
		await capture(args[1]);
		return;
	}
	if (args.length > 1 || args[0]?.startsWith('--')) throw new Error('Invalid arguments; use --help');
	const session = createDecoderSession();
	const input = args.length ? createReadStream(args[0]) : process.stdin;
	let lineNumber = 0;
	for await (const line of lines(input)) {
		lineNumber++;
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			const receiver = isNormalized(value) ? undefined : adaptReceiverRecord(value);
			const message = receiver?.message ?? normalizedInput(value);
			const source =
				isRecord(value) && typeof value.source === 'string' ? value.source : (receiver?.source ?? 'default');
			const result = session.push(message, source);
			await output({ ...result, source });
		} catch (error) {
			throw new Error(`Line ${lineNumber}: ${error instanceof Error ? error.message : 'Invalid input'}`, {
				cause: error,
			});
		}
	}
}

function isNormalized(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.label === 'string' &&
		typeof value.text === 'string' &&
		['id', 'receivedAt', 'registration', 'blockId', 'messageNumber', 'acknowledgement', 'continuation'].some(
			(key) => key in value,
		)
	);
}

function normalizedInput(value: unknown): AcarsInput {
	if (!isRecord(value) || typeof value.label !== 'string' || typeof value.text !== 'string')
		throw new TypeError('Expected an ACARS message or supported receiver JSON');
	return value as unknown as AcarsInput;
}

async function* lines(input: NodeJS.ReadableStream): AsyncGenerator<string> {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let pending = '';
	for await (const chunk of input) {
		pending += decoder.decode(chunk as Uint8Array, { stream: true });
		let newline = pending.indexOf('\n');
		while (newline >= 0) {
			if (Buffer.byteLength(pending.slice(0, newline), 'utf8') > 1_048_576)
				throw new RangeError('JSONL record exceeds one MiB');
			yield pending.slice(0, newline).replace(/\r$/, '');
			pending = pending.slice(newline + 1);
			newline = pending.indexOf('\n');
		}
		if (Buffer.byteLength(pending, 'utf8') > 1_048_576) throw new RangeError('JSONL record exceeds one MiB');
	}
	pending += decoder.decode();
	if (pending) yield pending;
}

async function capture(filename: string): Promise<void> {
	if ((await stat(filename)).size > 67_108_864) throw new RangeError('Capture exceeds 64 MiB');
	const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filename)));
	if (!isRecord(value) || !Array.isArray(value.sources)) throw new TypeError('Expected a capture with sources');
	for (const source of value.sources as unknown[]) {
		if (!isRecord(source) || !Array.isArray(source.messages)) throw new TypeError('Invalid capture source');
		const name = typeof source.vfoNumber === 'number' ? `vfo:${source.vfoNumber}` : 'capture';
		for (const message of decodeLog(source.messages as AcarsRecord[])) await output({ ...message, source: name });
	}
}

async function output(value: unknown): Promise<void> {
	if (!process.stdout.write(JSON.stringify(value) + '\n')) await once(process.stdout, 'drain');
}

main().catch((error: unknown) => {
	process.stderr.write(`acars-decode: ${error instanceof Error ? error.message : 'Replay failed'}\n`);
	process.exitCode = 1;
});
