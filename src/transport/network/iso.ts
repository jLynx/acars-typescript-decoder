import type { NetworkOption } from './types';
import { decodeNetworkOption } from './options/decode';

/** ISO 8473 header checksum, RFC 994 §6.11; a zero checksum means omitted. */
export function isoHeaderIntegrity(header: Uint8Array): 'verified' | 'failed' | 'unverified' {
	if (!header[7] && !header[8]) return 'unverified';
	if (!header[7] || !header[8]) return 'failed';
	let sum = 0,
		weighted = 0;
	for (const byte of header) {
		sum = (sum + byte) % 255;
		weighted = (weighted + sum) % 255;
	}
	return !sum && !weighted ? 'verified' : 'failed';
}

/** Preserve option bytes; X.233 bodies apply only to CLNP, while ES-IS interprets its own options. */
export function networkOptions(bytes: Uint8Array, protocol: 'CLNP' | 'ES-IS' = 'CLNP'): NetworkOption[] | undefined {
	const result: NetworkOption[] = [];
	let position = 0;
	while (position < bytes.length) {
		if (position + 2 > bytes.length) return;
		const id = bytes[position++],
			length = bytes[position++];
		if ((!length && id !== 0xcc) || position + length > bytes.length || result.some((option) => option.id === id))
			return;
		const raw = bytes.slice(position, position + length);
		const names: Partial<Record<number, string>> = {
			0xc1: 'Reason for discard',
			0xcc: 'Padding',
			0xc5: 'Security',
			0xc8: 'Source routing',
			0xcb: 'Route recording',
			0xc3: 'Quality of service',
			0xcd: 'Priority',
			...(protocol === 'CLNP' ? { 0xc4: 'Prefix scope control', 0xc6: 'Radius scope control' } : {}),
		};
		const option: NetworkOption = { id, name: names[id] ?? 'Unknown', raw };
		if (id === 0xcd && length === 1 && raw[0] <= 14) option.value = raw[0];
		if (protocol === 'CLNP') decodeNetworkOption(option);
		result.push(option);
		position += length;
	}
	return result;
}
