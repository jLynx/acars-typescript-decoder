// Independently implemented from X.233 (08/1997) §§7.5, 7.9.5. Standards are referenced, not redistributed.
import type { NetworkOption, NetworkOptionValue } from '@/transport/network/types';

export function decodeNetworkOption(option: NetworkOption): void {
	const { id, raw } = option;
	try {
		if ([0xc5, 0xc3].includes(id)) {
			const format = raw[0] >>> 6;
			option.decoded = { format, data: raw.slice(1) };
			if (id === 0xc3 && [0, 3].includes(format)) {
				if (raw.length !== 1) throw new Error('Globally unique QoS must contain one octet.');
				Object.assign(option.decoded, {
					qosUnavailable: Boolean(raw[0] & 32),
					sequencingPreferred: Boolean(raw[0] & 16),
					congestionExperienced: Boolean(raw[0] & 8),
					lowDelayOverCost: Boolean(raw[0] & 4),
					lowErrorOverDelay: Boolean(raw[0] & 2),
					lowErrorOverCost: Boolean(raw[0] & 1),
				});
			}
		} else if ([0xc8, 0xcb].includes(id)) option.decoded = route(raw, id === 0xcb);
		else if (id === 0xc4) option.decoded = { prefixes: prefixes(raw) };
		else if (id === 0xc6) {
			if (raw.length !== 2) throw new Error('Radius scope control requires two octets.');
			option.decoded = { radius: raw[0] * 256 + raw[1] };
		} else if (id === 0xc1) {
			if (raw.length !== 2) throw new Error('Discard reason requires two octets.');
			option.decoded = { discardReason: raw[0], errorOffset: raw[1] };
		} else if (id === 0xcd && (raw.length !== 1 || raw[0] > 14)) throw new Error('Invalid priority option.');
	} catch (error) {
		delete option.decoded;
		option.reason = error instanceof Error ? error.message : 'Invalid option.';
	}
}

function route(raw: Uint8Array, recording: boolean): NetworkOptionValue {
	if (raw.length < 2 || (recording ? raw[0] > 3 : ![1, 2].includes(raw[0])))
		throw new Error('Invalid routing option mode.');
	const pointer = raw[1],
		terminated = recording && pointer === 255;
	const end = recording && !terminated ? pointer - 1 : raw.length;
	if (pointer < 3 || end > raw.length) throw new Error('Invalid routing option pointer.');
	const entries: NonNullable<NetworkOptionValue['entries']> = [];
	let position = 2;
	const boundaries = [3];
	while (position < end) {
		const length = raw[position++];
		if (!length || position + length > end) throw new Error('Truncated routing entry.');
		const bytes = raw.slice(position, position + length);
		position += length;
		boundaries.push(position + 1);
		entries.push(recording && raw[0] >= 2 ? timedEntry(bytes) : { address: bytes });
	}
	if (!recording && !boundaries.includes(pointer)) throw new Error('Source route pointer does not identify an entry.');
	const complete = recording ? Boolean(raw[0] & 1) : raw[0] === 1;
	return {
		mode: complete ? 'complete' : 'partial',
		pointer,
		terminated,
		entries,
		unused: raw.slice(end),
	};
}

function timedEntry(bytes: Uint8Array): NonNullable<NetworkOptionValue['entries']>[number] {
	if (bytes.length < 4) throw new Error('Truncated route timestamp.');
	const timestamp = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
	const utcMidnight = !(timestamp & 0x80000000);
	if (utcMidnight && timestamp >= 86400000) throw new Error('Invalid route UTC timestamp.');
	return { address: bytes.slice(4), timestamp: timestamp & 0x7fffffff, timestampUnit: 'ms', utcMidnight };
}

function prefixes(raw: Uint8Array): Array<{ bits: number; bytes: Uint8Array }> {
	const result: Array<{ bits: number; bytes: Uint8Array }> = [];
	let position = 0;
	while (position < raw.length) {
		const bits = raw[position++],
			length = Math.ceil(bits / 8);
		if (!bits || position + length > raw.length) throw new Error('Invalid scope prefix length.');
		const bytes = raw.slice(position, position + length);
		position += length;
		if (bits % 8 && bytes.at(-1)! & ((1 << (8 - (bits % 8))) - 1)) throw new Error('Nonzero scope prefix padding.');
		result.push({ bits, bytes });
	}
	return result;
}
