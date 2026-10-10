import type { Bits } from '@/payload/protocols/bits';

/** X.691 unaligned PER length determinant, including bounded fragment sequences. */
export function perLength(bits: Bits): { length: number; fragmented: boolean } {
	const first = bits.read(8);
	if (first < 128) return { length: first, fragmented: false };
	if (first < 192) return { length: (first & 63) * 256 + bits.read(8), fragmented: false };
	const multiplier = first & 63;
	if (multiplier < 1 || multiplier > 4) throw new Error('Invalid PER fragment length');
	return { length: multiplier * 16384, fragmented: true };
}

export function perPayload(bits: Bits, unit: 1 | 8): { payload: Uint8Array; bitLength: number } {
	const output: number[] = [];
	let bitLength = 0;
	let fragmented: boolean;
	do {
		const length = perLength(bits);
		fragmented = length.fragmented;
		const count = length.length * unit;
		if (bitLength + count > 65536 || count > bits.remaining) throw new Error('Truncated or oversized PER payload');
		for (let i = 0; i < count; i++, bitLength++) {
			const index = bitLength >> 3;
			output[index] = (output[index] ?? 0) | (bits.read(1) << (7 - (bitLength % 8)));
		}
	} while (fragmented);
	return { payload: Uint8Array.from(output), bitLength };
}

export function perInteger(bits: Bits): number {
	const { payload, bitLength } = perPayload(bits, 8);
	if (bitLength === 0 || payload.length > 6 || payload[0] & 128) throw new Error('Invalid presentation context');
	let result = 0;
	for (const octet of payload) result = result * 256 + octet;
	return result;
}

export function perOid(bits: Bits): string {
	const { payload } = perPayload(bits, 8);
	if (!payload.length || payload.length > 64) throw new Error('Invalid transfer syntax OID');
	const subidentifiers: number[] = [];
	let current = 0;
	let first = true;
	for (const octet of payload) {
		if (first && octet === 128) throw new Error('Nonminimal transfer syntax OID');
		current = current * 128 + (octet & 127);
		if (!Number.isSafeInteger(current)) throw new Error('Oversized transfer syntax OID');
		first = false;
		if (!(octet & 128)) {
			subidentifiers.push(current);
			current = 0;
			first = true;
		}
	}
	if (!first) throw new Error('Truncated transfer syntax OID');
	const head = subidentifiers.shift()!;
	const arc = head < 40 ? 0 : head < 80 ? 1 : 2;
	return [arc, head - arc * 40, ...subidentifiers].join('.');
}
