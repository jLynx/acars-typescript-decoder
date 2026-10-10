import type { CotpOptions, CotpPdu } from '@/transport/network/types';

export function atnProfile(pdu: CotpPdu): 16 | 32 | undefined {
	if (pdu.parameters.some((part) => part.id === 8)) return 32;
	if (pdu.parameters.some((part) => part.id === 9)) return 16;
}

export function sameAddresses(left: CotpOptions['atnAddresses'], right: CotpOptions['atnAddresses']): boolean {
	if (!left || !right) return left === right;
	return (['source', 'destination'] as const).every(
		(key) => left[key].length === right[key].length && left[key].every((byte, index) => byte === right[key][index]),
	);
}

export function directedAddresses(
	addresses: CotpOptions['atnAddresses'],
	reverse: boolean,
): CotpOptions['atnAddresses'] {
	if (!addresses || !reverse) return addresses;
	return { source: addresses.destination, destination: addresses.source };
}
