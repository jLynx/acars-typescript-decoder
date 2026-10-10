// X.691/Doc9705 ACSE values adapted from the pinned Wireshark ULCS schema.
import type { Bits } from '@/payload/protocols/bits';
import { perLength, perOid, perPayload } from './per';
import type { AtnAcse, AtnAcseExternal } from './types';

export function signedInteger(bits: Bits): number {
	const { payload } = perPayload(bits, 8);
	if (!payload.length || payload.length > 6) throw new Error('Invalid ACSE integer');
	let value = payload[0] & 128 ? -1 : 0;
	for (const byte of payload) value = value * 256 + byte;
	return value;
}

export function normallySmall(bits: Bits): number {
	if (!bits.read(1)) return bits.read(6);
	const { payload } = perPayload(bits, 8);
	if (!payload.length || payload.length > 6) throw new Error('Invalid large normally-small value');
	let value = 0;
	for (const byte of payload) value = value * 256 + byte;
	return value;
}

export function extensibleInteger(bits: Bits, width: number, maximum: number): number {
	return bits.read(1) ? signedInteger(bits) : bits.constrained(width, 0, maximum);
}

export function enumValue(bits: Bits, count: number): number {
	return bits.read(1) ? normallySmall(bits) + count : bits.constrained(Math.ceil(Math.log2(count)), 0, count - 1);
}

export function external(bits: Bits, result: AtnAcse): AtnAcseExternal {
	const flags = [bits.read(1), bits.read(1), bits.read(1)];
	const directReference = flags[0] ? perOid(bits) : undefined;
	const indirectReference = flags[1] ? signedInteger(bits) : undefined;
	const dataValueDescriptor = flags[2] ? perPayload(bits, 8).payload : undefined;
	const choice = bits.constrained(2, 0, 2);
	if (flags[0] || flags[2] || choice !== 2) result.profileSupported = false;
	return {
		...(directReference ? { directReference } : {}),
		...(indirectReference !== undefined ? { indirectReference } : {}),
		...(dataValueDescriptor ? { dataValueDescriptor } : {}),
		encoding: (['single-ASN1-type', 'octet-aligned', 'arbitrary'] as const)[choice],
		...perPayload(bits, choice === 2 ? 1 : 8),
	};
}

export function information(bits: Bits, result: AtnAcse): void {
	let count = 1;
	if (bits.read(1)) {
		const length = perLength(bits);
		if (length.fragmented || length.length === 1 || length.length > 16)
			throw new Error('Unsupported ACSE information length');
		count = length.length;
		result.profileSupported = false;
	}
	for (let index = 0; index < count; index++) result.userInformation.push(external(bits, result));
}

export function extensions(bits: Bits, result: AtnAcse): void {
	const count = normallySmall(bits) + 1;
	if (count > 64) throw new Error('Too many ACSE extensions');
	const flags = Array.from({ length: count }, () => bits.read(1));
	for (let index = 0; index < count; index++) {
		if (flags[index]) result.extensions.push({ index, payload: perPayload(bits, 8).payload });
	}
	result.profileSupported = false;
}

export function title(bits: Bits, integer: boolean): number | string {
	if (bits.read(1) || bits.read(1)) throw new Error('Excluded or extended ACSE title form; raw bytes retained');
	return integer ? signedInteger(bits) : perOid(bits);
}

export function authentication(bits: Bits, result: AtnAcse): void {
	const choice = bits.read(2);
	result.fields.authenticationEncoding = ['charstring', 'bitstring', 'external', 'other'][choice];
	if (choice === 3) throw new Error('Excluded authentication other value; raw bytes retained');
	if (choice === 2) {
		const value = external(bits, result);
		result.fields.authenticationValue = { payload: value.payload, bitLength: value.bitLength };
	} else result.fields.authenticationValue = perPayload(bits, choice === 1 ? 1 : 8);
	result.profileSupported = false;
}
