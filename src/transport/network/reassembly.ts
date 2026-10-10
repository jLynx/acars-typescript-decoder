import { decodeClnpCompressed, decodeX25 } from './x25';
import { decodeClnp } from './clnp';
import { decodeEsis } from './esis';
import type { X25Assembly, X25Chain, X25Packet, X25Reassembler, X25ReassemblyOptions, X25Reception } from './types';

function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		throw new RangeError('Invalid X.25 reassembly limit');
	return result;
}

/** Bounded, in-order modulo-8 M-bit reassembly. A failed chain requires expiry or a circuit reset. */
export function createX25Reassembler(options: X25ReassemblyOptions = {}): X25Reassembler {
	const maxChannels = limit(options.maxChannels, 64, 256);
	const maxBytes = limit(options.maxBytes, 8192, 8192);
	const maxFragments = limit(options.maxFragments, 128, 1024);
	const retentionMs = limit(options.retentionMs, 60_000, 3_600_000);
	const chains = new Map<string, X25Chain>();
	let watermark = -Infinity;
	return {
		push(bytes, reception) {
			validateReception(reception);
			const packet = decodeX25(bytes, options);
			if (!packet) throw new TypeError('Invalid modulo-8 X.25 packet');
			// A final M=0 packet may only be the tail of a fragmented NSDU.
			// Inner output belongs exclusively to the completed assembly below.
			delete packet.clnp;
			delete packet.network;
			delete packet.esis;
			watermark = Math.max(watermark, reception.receivedAt);
			const key = `${reception.link}\0${packet.channelGroup}:${packet.channel}`;
			const expiredAssembly = chains.get(key);
			const discarded = [...chains].filter(([, chain]) => watermark - chain.firstAt > retentionMs).map(([id]) => id);
			for (const id of discarded) chains.delete(id);
			const result: X25Assembly = { status: 'ignored', packet, fragments: 0, discarded };
			if (expired(watermark, reception.receivedAt, retentionMs, discarded.includes(key), expiredAssembly)) {
				result.status = 'failed';
				result.reason = 'Fragment reception window expired.';
				return result;
			}
			const previous = chains.get(key);
			if (packet.type !== 'Data') {
				if (packet.type === 'Unknown' && previous)
					fail(previous, result, 'Unsupported circuit control interrupted assembly.');
				return result;
			}
			if (previous && duplicate(previous.lastPacket, packet)) {
				result.status = previous.failure ? 'failed' : 'duplicate';
				result.fragments = previous.fragments;
				result.reason = previous.failure;
				return result;
			}
			if (previous?.complete && packet.sendSequence !== (previous.lastPacket.sendSequence! + 1) % 8) {
				fail(previous, result, 'Missing or conflicting packet sequence.');
				return result;
			}
			const chain = previous?.complete ? undefined : previous;
			if (chain) {
				const failure = append(chain, packet, maxBytes, maxFragments, reception.receivedAt);
				if (failure) {
					fail(chain, result, failure);
					return result;
				}
			} else {
				if (packet.payload.length > maxBytes) {
					result.status = 'failed';
					result.reason = 'Payload exceeds the byte limit.';
					return result;
				}
				chains.delete(key);
				if (chains.size >= maxChannels) {
					const oldest = chains.keys().next().value!;
					chains.delete(oldest);
					discarded.push(oldest);
				}
				const retained = snapshot(packet);
				chains.set(key, {
					link: reception.link,
					firstAt: reception.receivedAt,
					lastAt: reception.receivedAt,
					lastPacket: retained,
					parts: [retained.payload],
					length: packet.payload.length,
					fragments: 1,
				});
			}
			finish(chains.get(key)!, result, options);
			return result;
		},
		reset(link) {
			for (const [key, chain] of chains) if (link === undefined || chain.link === link) chains.delete(key);
		},
		stats() {
			return { channels: chains.size, bytes: [...chains.values()].reduce((sum, chain) => sum + chain.length, 0) };
		},
	};
}

function expired(
	watermark: number,
	receivedAt: number,
	retentionMs: number,
	discarded: boolean,
	chain?: X25Chain,
): boolean {
	return watermark - receivedAt > retentionMs || (discarded && !chain?.complete);
}

function validateReception(reception: X25Reception): void {
	if (
		typeof reception.link !== 'string' ||
		!reception.link ||
		reception.link.length > 240 ||
		reception.link.includes('\0')
	)
		throw new TypeError('Invalid X.25 link identity');
	if (!Number.isFinite(reception.receivedAt)) throw new TypeError('Invalid X.25 reception time');
}

function snapshot(packet: X25Packet): X25Packet {
	return {
		...packet,
		raw: new Uint8Array(),
		payload: packet.payload.slice(),
		clnp: undefined,
		network: undefined,
		esis: undefined,
	};
}

function duplicate(previous: X25Packet, packet: X25Packet): boolean {
	return (
		previous.sendSequence === packet.sendSequence &&
		previous.more === packet.more &&
		previous.qualifier === packet.qualifier &&
		previous.deliveryConfirmation === packet.deliveryConfirmation &&
		previous.payload.length === packet.payload.length &&
		previous.payload.every((byte, index) => byte === packet.payload[index])
	);
}

function append(
	chain: X25Chain,
	packet: X25Packet,
	maxBytes: number,
	maxFragments: number,
	receivedAt: number,
): string | undefined {
	if (chain.failure) return chain.failure;
	if (receivedAt < chain.lastAt) return 'Fragments arrived out of reception order.';
	if (packet.sendSequence !== (chain.lastPacket.sendSequence! + 1) % 8)
		return 'Missing or conflicting packet sequence.';
	if (
		packet.qualifier !== chain.lastPacket.qualifier ||
		packet.deliveryConfirmation !== chain.lastPacket.deliveryConfirmation
	)
		return 'Qualifier or delivery-confirmation flags conflict.';
	if (chain.length + packet.payload.length > maxBytes || chain.fragments >= maxFragments)
		return 'Assembly exceeds its resource limit.';
	const retained = snapshot(packet);
	chain.parts.push(retained.payload);
	chain.length += packet.payload.length;
	chain.fragments++;
	chain.lastPacket = retained;
	chain.lastAt = receivedAt;
}

function fail(chain: X25Chain, result: X25Assembly, reason: string): void {
	chain.failure = reason;
	chain.complete = false;
	chain.parts = [];
	chain.lastPacket.payload = new Uint8Array();
	chain.length = 0;
	result.status = 'failed';
	result.reason = reason;
	result.fragments = chain.fragments;
}

function finish(chain: X25Chain, result: X25Assembly, options: X25ReassemblyOptions): void {
	result.fragments = chain.fragments;
	result.status = chain.lastPacket.more ? 'pending' : 'complete';
	if (result.status === 'pending') return;
	const payload = new Uint8Array(chain.length);
	let offset = 0;
	for (const part of chain.parts) {
		payload.set(part, offset);
		offset += part.length;
	}
	result.payload = payload;
	if (payload[0] === 0x81) result.network = decodeClnp(payload, options);
	else if (payload[0] === 0x82) result.esis = decodeEsis(payload);
	else result.clnp = decodeClnpCompressed(payload, options);
	chain.complete = true;
	// Keep only the final packet for duplicate suppression after releasing assembled fragments.
	chain.parts = [];
	chain.length = chain.lastPacket.payload.length;
}
