import type { NetworkOption } from './types';

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

/** Preserve option bytes. Only the independently specified priority value is assigned a meaning here. */
export function networkOptions(bytes: Uint8Array): NetworkOption[] | undefined {
	const result: NetworkOption[] = [];
	let position = 0;
	while (position < bytes.length) {
		if (position + 2 > bytes.length) return;
		const id = bytes[position++],
			length = bytes[position++];
		if (!length || position + length > bytes.length || result.some((option) => option.id === id)) return;
		const raw = bytes.slice(position, position + length);
		const names: Record<number, string> = {
			0xc1: 'Reason for discard',
			0xcc: 'Padding',
			0xc5: 'Security',
			0xc8: 'Source routing',
			0xcb: 'Route recording',
			0xc3: 'Quality of service',
			0xcd: 'Priority',
		};
		const option: NetworkOption = { id, name: names[id] ?? 'Unknown', raw };
		if (id === 0xcd && length === 1 && raw[0] <= 14) option.value = raw[0];
		result.push(option);
		position += length;
	}
	return result;
}
