// Independent ISO 8473 reassembly from RFC 994 §§6.4, 6.7–6.8.
import { decodeClnp } from './clnp';
import { decodeCotp } from './cotp';
import { decodeIdrp } from './idrp';
import type { ClnpAssembly, ClnpChain, ClnpPdu, ClnpReassembler, ClnpReassemblyOptions, ClnpReception } from './types';

function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		throw new RangeError('Invalid CLNP reassembly limit');
	return result;
}

/** Verified headers only; byte-identical overlaps are accepted, conflicts poison a message until expiry/reset. */
export function createClnpReassembler(options: ClnpReassemblyOptions = {}): ClnpReassembler {
	const maxAssemblies = limit(options.maxAssemblies, 64, 256);
	const maxBytes = limit(options.maxBytes, 8192, 8192);
	const maxFragments = limit(options.maxFragments, 128, 1024);
	const retentionMs = limit(options.retentionMs, 60_000, 3_600_000);
	const chains = new Map<string, ClnpChain>();
	let watermark = -Infinity;
	return {
		push(bytes, reception) {
			validateReception(reception);
			const packet = decodeClnp(bytes, options);
			if (!packet) throw new TypeError('Invalid uncompressed CLNP PDU');
			delete packet.cotp;
			delete packet.idrp;
			watermark = Math.max(watermark, reception.receivedAt);
			const key = messageKey(packet, reception.link);
			const previous = chains.get(key);
			const discarded = [...chains].filter(([, chain]) => watermark >= chain.deadline).map(([id]) => id);
			for (const id of discarded) chains.delete(id);
			const result: ClnpAssembly = { status: 'ignored', packet, fragments: 0, discarded };
			if (packet.type !== 'Data') return result;
			const invalid = invalidReception(packet, reception, watermark, retentionMs, previous, discarded.includes(key));
			if (invalid) return rejected(result, invalid);
			if (!packet.segmentationPermitted) {
				if (packet.payload!.length > maxBytes) return rejected(result, 'Payload exceeds the byte limit.');
				finish(result, packet.payload!, options);
				result.fragments = 1;
				return result;
			}
			let chain = chains.get(key);
			if (!chain) {
				const length = packet.totalLength! - packet.headerLength;
				if (length > maxBytes) return rejected(result, 'Payload exceeds the byte limit.');
				if (chains.size >= maxAssemblies) {
					const oldest = chains.keys().next().value!;
					chains.delete(oldest);
					discarded.push(oldest);
				}
				chain = {
					link: reception.link,
					firstAt: reception.receivedAt,
					lastAt: reception.receivedAt,
					deadline: reception.receivedAt + retentionMs,
					header: comparableHeader(packet),
					data: new Uint8Array(length),
					present: new Uint8Array(length),
					covered: 0,
					fragments: 0,
				};
				chains.set(key, chain);
			}
			const previousFragments = chain.fragments;
			const failure = append(chain, packet, reception.receivedAt, maxFragments);
			result.fragments = chain.fragments;
			if (failure) {
				chain.failure = failure;
				chain.data = chain.present = new Uint8Array();
				return rejected(result, failure);
			}
			if (previousFragments === chain.fragments) {
				result.status = 'duplicate';
				return result;
			}
			result.status = chain.covered === chain.data.length ? 'complete' : 'pending';
			if (result.status === 'complete') finish(result, chain.data, options);
			return result;
		},
		reset(link) {
			for (const [key, chain] of chains) if (link === undefined || chain.link === link) chains.delete(key);
		},
		stats() {
			return {
				assemblies: chains.size,
				bytes: [...chains.values()].reduce((sum, chain) => sum + chain.data.length, 0),
			};
		},
	};
}

function validateReception(reception: ClnpReception): void {
	if (
		typeof reception.link !== 'string' ||
		!reception.link ||
		reception.link.length > 240 ||
		reception.link.includes('\0')
	)
		throw new TypeError('Invalid CLNP link identity');
	if (!Number.isFinite(reception.receivedAt)) throw new TypeError('Invalid CLNP reception time');
}

function messageKey(packet: ClnpPdu, link: string): string {
	return JSON.stringify([
		link,
		packet.source && [...packet.source],
		packet.destination && [...packet.destination],
		packet.pduId,
	]);
}

function invalidReception(
	packet: ClnpPdu,
	reception: ClnpReception,
	watermark: number,
	retentionMs: number,
	previous: ClnpChain | undefined,
	expired: boolean,
): string | undefined {
	if (packet.integrity !== 'verified') return 'CLNP header checksum is not verified.';
	if (!packet.lifetime) return 'PDU lifetime expired.';
	if (watermark - reception.receivedAt >= Math.min(retentionMs, packet.lifetime * 1000))
		return 'Fragment reception window expired.';
	if (expired && previous && (previous.failure || previous.covered !== previous.data.length))
		return 'Fragment reception window expired.';
	if (previous && reception.receivedAt < previous.lastAt) return 'Fragments arrived out of reception order.';
}

/** Options may change on different routes. Conservatively require identical option bytes rather than invent merging rules. */
function comparableHeader(packet: ClnpPdu): Uint8Array {
	const header = packet.raw.slice(0, packet.headerLength);
	header[3] = 0;
	header[4] &= ~64;
	header.fill(0, 5, 9);
	const segmentation = 11 + packet.destination!.length + packet.source!.length;
	header.fill(0, segmentation + 2, segmentation + 4);
	return header;
}

function append(chain: ClnpChain, packet: ClnpPdu, receivedAt: number, maxFragments: number): string | undefined {
	if (chain.failure) return chain.failure;
	chain.lastAt = receivedAt;
	chain.deadline = Math.min(chain.deadline, receivedAt + packet.lifetime * 1000);
	const header = comparableHeader(packet);
	if (header.length !== chain.header.length || header.some((byte, index) => byte !== chain.header[index]))
		return 'Total length, flags or header options conflict.';
	const payload = packet.payload!,
		offset = packet.offset!;
	let added = 0;
	for (let index = 0; index < payload.length; index++) {
		if (chain.present[offset + index]) {
			if (chain.data[offset + index] !== payload[index]) return 'Overlapping fragment bytes conflict.';
		} else added++;
	}
	// An empty complete PDU still counts as one fragment; retransmissions consume no new storage/count.
	if (!added && chain.fragments) return;
	if (chain.fragments >= maxFragments) return 'Assembly exceeds its fragment limit.';
	chain.data.set(payload, offset);
	chain.present.fill(1, offset, offset + payload.length);
	chain.covered += added;
	chain.fragments++;
}

function rejected(result: ClnpAssembly, reason: string): ClnpAssembly {
	result.status = 'failed';
	result.reason = reason;
	return result;
}

function finish(result: ClnpAssembly, payload: Uint8Array, options: ClnpReassemblyOptions): void {
	result.status = 'complete';
	result.payload = payload.slice();
	if (payload[0] === 0x85) result.idrp = decodeIdrp(payload);
	else {
		const cotp = decodeCotp(payload, {
			...options,
			atnAddresses: { source: result.packet.source!, destination: result.packet.destination! },
		});
		if (cotp?.pdus.length) result.cotp = cotp;
	}
}
