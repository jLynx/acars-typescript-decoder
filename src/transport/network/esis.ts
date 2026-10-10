// Independent ES-IS common/ISH/RD layouts from RFC 995 §8; ESH address-list variants remain raw.
import { isoHeaderIntegrity, networkOptions } from './iso';
import type { EsisPdu } from './types';

/** ES-IS routing exchange. Checksum applies to the whole PDU; no application payload is carried. */
export function decodeEsis(bytes: Uint8Array): EsisPdu | undefined {
	if (!(bytes instanceof Uint8Array) || bytes.length < 9 || bytes.length > 254 || bytes[0] !== 0x82) return;
	if (bytes[1] !== bytes.length || bytes[2] !== 1 || bytes[3] || bytes[4] & 0xe0) return;
	const type = bytes[4];
	if (![2, 4, 6].includes(type)) return;
	const result: EsisPdu = {
		protocol: 'ES-IS',
		type: type === 2 ? 'End System Hello' : type === 4 ? 'Intermediate System Hello' : 'Redirect',
		coverage: 'partial',
		holdingTime: bytes[5] * 256 + bytes[6],
		holdingTimeUnit: 's',
		integrity: isoHeaderIntegrity(bytes),
		raw: bytes.slice(),
	};
	if (result.integrity === 'failed') return result;
	if (type === 2) {
		result.addressesRaw = bytes.slice(9);
		return result;
	}
	let position = 9;
	const address = (allowEmpty = false, maximum = 20): Uint8Array | undefined => {
		if (position >= bytes.length) return;
		const length = bytes[position++];
		if ((!allowEmpty && !length) || length > maximum || position + length > bytes.length) return;
		const value = bytes.slice(position, position + length);
		position += length;
		return value;
	};
	if (type === 4) {
		result.networkEntityTitle = address();
		if (!result.networkEntityTitle) return;
	} else {
		result.destination = address();
		if (!result.destination) return;
		result.betterSubnetworkAddress = address(false, 254);
		if (!result.betterSubnetworkAddress) return;
		result.networkEntityTitle = address(true);
		if (!result.networkEntityTitle) return;
	}
	result.options = networkOptions(bytes.subarray(position));
	if (!result.options) return;
	return result;
}
