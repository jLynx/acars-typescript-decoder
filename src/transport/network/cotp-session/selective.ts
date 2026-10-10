// Independent X.224 §§12.2.3.6, 13.9.4 d). Ranges are inclusive, including modular wrap.
import type { CotpPdu, CotpSelectiveBlock } from '@/transport/network/types';
import { parameter } from './parameters';

export function selectiveBlocks(pdu: CotpPdu, negotiated: boolean): CotpSelectiveBlock[] {
	const bytes = parameter(pdu, 0x8f);
	if (!bytes) return [];
	if (!negotiated) throw new Error('Selective acknowledgement was not negotiated.');
	const width = pdu.format === 'normal' ? 1 : 4;
	if (!bytes.length || bytes.length % (width * 2)) throw new Error('Invalid selective acknowledgement length.');
	const modulus = width === 1 ? 128 : 2 ** 31;
	const blocks: CotpSelectiveBlock[] = [];
	for (let offset = 0; offset < bytes.length; offset += width * 2) {
		const lower = edge(bytes.subarray(offset, offset + width)),
			upper = edge(bytes.subarray(offset + width, offset + width * 2));
		const start = (lower - pdu.receiveSequence! + modulus) % modulus;
		const end = (upper - pdu.receiveSequence! + modulus) % modulus;
		if (start === 0 || end < start || end >= modulus / 2) throw new Error('Invalid selective acknowledgement range.');
		const previous = blocks.at(-1);
		if (previous && start <= ((previous.upper - pdu.receiveSequence! + modulus) % modulus) + 1)
			throw new Error('Selective blocks overlap, are adjacent, or are out of order.');
		blocks.push({ lower, upper });
	}
	return blocks;
}

function edge(bytes: Uint8Array): number {
	if (bytes[0] & 128) throw new Error('Reserved selective sequence bit is set.');
	return bytes.reduce((value, byte) => value * 256 + byte, 0);
}

export function retainSelective(
	previous: CotpSelectiveBlock[],
	incoming: CotpSelectiveBlock[],
	lower: number,
	modulus: number,
): CotpSelectiveBlock[] {
	const spans: CotpSelectiveBlock[] = [];
	for (const block of [...previous, ...incoming]) {
		let start = (block.lower - lower + modulus) % modulus;
		const end = (block.upper - lower + modulus) % modulus;
		if (end >= modulus / 2) continue;
		if (start >= modulus / 2) start = 0;
		spans.push({ lower: start, upper: end });
	}
	spans.sort((a, b) => a.lower - b.lower);
	const merged: CotpSelectiveBlock[] = [];
	for (const span of spans) {
		const last = merged.at(-1);
		if (last && span.lower <= last.upper + 1) last.upper = Math.max(last.upper, span.upper);
		else merged.push({ ...span });
	}
	if (merged.length > 128) throw new Error('Retained selective acknowledgement block limit exceeded.');
	return merged.map((span) => ({ lower: (span.lower + lower) % modulus, upper: (span.upper + lower) % modulus }));
}

export function isSelective(sequence: number, blocks: CotpSelectiveBlock[], modulus: number): boolean {
	return blocks.some(
		(block) => (sequence - block.lower + modulus) % modulus <= (block.upper - block.lower + modulus) % modulus,
	);
}
