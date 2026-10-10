import type { AvlcAddress } from './types';

/** Four AVLC address octets; EA terminates the combined address field after the source. */
export function decodeAvlcAddress(bytes: Uint8Array): AvlcAddress {
	if (bytes.length !== 4) throw new RangeError('AVLC address must contain four bytes');
	if (bytes.slice(0, 3).some((byte) => byte & 1)) throw new Error('Invalid AVLC address extension bits');
	let raw = 0,
		value = 0;
	for (let index = 0; index < 4; index++) raw += (bytes[index] >>> 1) * 2 ** (index * 7);
	for (let bit = 0; bit < 28; bit++) value = value * 2 + ((raw >>> bit) & 1);
	const type = (value >>> 24) & 7;
	return {
		address: value & 0xffffff,
		addressType: type,
		kind: type === 1 ? 'aircraft' : type === 4 || type === 5 ? 'ground' : type === 7 ? 'broadcast' : 'unknown',
		status: Boolean(value & 0x8000000),
	};
}
