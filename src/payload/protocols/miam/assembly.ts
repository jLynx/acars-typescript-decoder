import type { InterpretedAcarsRecord } from '@/payload/types';
import type { MiamFileChain, MiamFileFrame } from './types';
import { readMiamFile } from './files';
import { interpretMiamCore } from '@/payload/protocols/miam';
import { applicationStatus } from '@/payload/protocols/assembly/application-status';

/** Request-defined CF files, bounded to 64 KiB, 999 segments and fifteen minutes. */
export function assembleMiamFiles(records: InterpretedAcarsRecord[]): void {
	const pending = new Map<string, MiamFileChain>();
	for (const record of records) {
		for (const [key, chain] of pending) {
			if (record.receivedAt - chain.first.receivedAt > 900_000) pending.delete(key);
		}
		if (!['MA', 'H1'].includes(record.label) || record.continuation || !record.registration) continue;
		const text = (record.assembledText ?? record.text).replace(
			/^(?:#[A-Z0-9]{2}B|- #[A-Z0-9]{2})(?:\/[A-Z0-9]{2} )?/,
			'',
		);
		const frame = readMiamFile(text);
		if (!frame) continue;
		const base = `${record.registration}\0${record.mode}\0`;
		const key = `${base}${record.direction}\0${frame.fileId}`;
		if (frame.type === 'A') {
			pending.delete(`${base}downlink\0${frame.fileId}`);
			pending.delete(`${base}uplink\0${frame.fileId}`);
		} else if (frame.type === 'F') {
			startFile(pending, key, record, frame);
		} else if (frame.type === 'S') {
			const chain = pending.get(key);
			const failure = chain ? addSegment(chain, record, frame) : 'No matching file request is available.';
			if (failure) {
				pending.delete(key);
				record.interpretation.notes.push(`MIAM reassembly unavailable: ${failure}`);
				applicationStatus(record, { protocol: 'MIAM', status: 'failed', identifier: frame.fileId, reason: failure });
			} else if (chain && complete(chain)) {
				decodeFile(chain, record);
			} else applicationStatus(record, { protocol: 'MIAM', status: 'pending', identifier: frame.fileId });
		}
	}
}

function startFile(
	pending: Map<string, MiamFileChain>,
	key: string,
	record: InterpretedAcarsRecord,
	frame: Extract<MiamFileFrame, { type: 'F' }>,
): void {
	const previous = pending.get(key);
	if (
		previous &&
		previous.request.size === frame.size &&
		previous.request.validity === frame.validity &&
		previous.first.flight === record.flight
	)
		return;
	pending.delete(key);
	if (frame.size < 1 || frame.size > 65_536) {
		record.interpretation.notes.push('MIAM reassembly unavailable: Declared file size exceeds the 1–65536 byte range.');
		return;
	}
	if (pending.size >= 128) pending.delete(pending.keys().next().value!);
	pending.set(key, { first: record, last: record, request: frame, parts: new Map(), length: 0 });
	applicationStatus(record, { protocol: 'MIAM', status: 'pending', identifier: frame.fileId });
}

function addSegment(
	chain: MiamFileChain,
	record: InterpretedAcarsRecord,
	frame: Extract<MiamFileFrame, { type: 'S' }>,
): string | undefined {
	if (chain.first.flight && record.flight && chain.first.flight !== record.flight)
		return 'Flight identifiers conflict.';
	if ([...frame.text].some((char) => char.charCodeAt(0) > 127)) return 'File segment contains non-ASCII data.';
	const previous = chain.parts.get(frame.sequence);
	if (previous !== undefined && previous !== frame.text) return 'Retransmitted segment has conflicting content.';
	if (previous === undefined) {
		if (chain.length + frame.text.length > chain.request.size) return 'Segments exceed the declared file length.';
		chain.parts.set(frame.sequence, frame.text);
		chain.length += frame.text.length;
	}
	chain.last = record;
}

function complete(chain: MiamFileChain): boolean {
	return (
		chain.length === chain.request.size &&
		Array.from({ length: chain.parts.size }, (_, index) => chain.parts.has(index + 1)).every(Boolean)
	);
}

function decodeFile(chain: MiamFileChain, record: InterpretedAcarsRecord): void {
	const text = Array.from({ length: chain.parts.size }, (_, index) => chain.parts.get(index + 1)!).join('');
	const result = interpretMiamCore({ ...record, text: `T${text}`, continuation: false });
	if (!result) {
		record.interpretation.notes.push('Complete MIAM file has an unsupported or malformed CORE layout.');
		applicationStatus(record, {
			protocol: 'MIAM',
			status: 'failed',
			identifier: chain.request.fileId,
			reason: 'Unsupported or malformed CORE layout.',
		});
		return;
	}
	applicationStatus(record, {
		protocol: 'MIAM',
		status: result.transfer || result.coverage === 'decoded' ? 'complete' : 'failed',
		identifier: chain.request.fileId,
	});
	result.fields.unshift({ label: 'File ID', value: chain.request.fileId });
	result.notes.push(
		`Reassembled MIAM file ${chain.request.fileId}: ${chain.parts.size} segments, ${chain.length} bytes matching its request.`,
		...record.interpretation.notes.filter((note) => note.startsWith('Reassembled ')),
	);
	record.interpretation = result;
}
