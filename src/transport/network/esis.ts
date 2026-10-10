// Common/ISH/RD from RFC 995 §8. ESH lists/ISH timer adapted from NetBSD netiso/esis.c/h
// revision 8c101a16ae09856a61284f770c2099b38186fe7c (BSD-3-Clause and IBM permission; see notices).
import { isoHeaderIntegrity, networkOptions } from './iso';
import type { EsisOptions, EsisPdu } from './types';

/** ES-IS routing exchange. Checksum applies to the whole PDU; no application payload is carried. */
export function decodeEsis(bytes: Uint8Array, options: EsisOptions = {}): EsisPdu | undefined {
	if (!validPdu(bytes)) return;
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
	if (type === 2) return readEsh(bytes, result, options);
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
	result.options = networkOptions(bytes.subarray(position), 'ES-IS');
	if (!result.options) return;
	if (type === 4 && !readConfigurationTimer(result)) return;
	return result;
}

function validPdu(bytes: Uint8Array): boolean {
	return (
		bytes instanceof Uint8Array &&
		bytes.length >= 9 &&
		bytes.length <= 254 &&
		bytes[0] === 0x82 &&
		bytes[1] === bytes.length &&
		bytes[2] === 1 &&
		!bytes[3] &&
		!(bytes[4] & 0xe0)
	);
}

function readConfigurationTimer(result: EsisPdu): boolean {
	const timer = result.options!.find((option) => option.id === 0xc6);
	if (!timer) return true;
	if (timer.raw.length !== 2) return false;
	timer.name = 'End system configuration timer';
	timer.value = timer.raw[0] * 256 + timer.raw[1];
	timer.unit = 's';
	delete timer.decoded;
	delete timer.reason;
	return true;
}

function readEsh(bytes: Uint8Array, result: EsisPdu, options: EsisOptions): EsisPdu | undefined {
	const format = options.eshFormat ?? 'address-list';
	if (!['address-list', 'legacy-single', 'raw'].includes(format)) return;
	result.eshFormat = format;
	// Preserve the complete address/options region for old consumers and unknown variants.
	result.addressesRaw = bytes.slice(9);
	if (format === 'raw') return result;
	let position = 9;
	const count = format === 'address-list' ? bytes[position++] : 1;
	if (!count || count > Math.floor((bytes.length - position) / 2)) return;
	const addresses: Uint8Array[] = [];
	for (let index = 0; index < count; index++) {
		const length = bytes[position++];
		if (!length || length > 20 || position + length > bytes.length) return;
		addresses.push(bytes.slice(position, position + length));
		position += length;
	}
	const parsedOptions = networkOptions(bytes.subarray(position), 'ES-IS');
	if (!parsedOptions) return;
	result.sourceAddresses = addresses;
	result.options = parsedOptions;
	return result;
}
