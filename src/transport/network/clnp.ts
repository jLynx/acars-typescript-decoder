// Independent ISO 8473 implementation from RFC 994 §§6.11, 7.2–7.9; no third-party parser copied.
import { decodeCotp } from './cotp';
import { decodeIdrp } from './idrp';
import { isoHeaderIntegrity, networkOptions } from './iso';
import type { ClnpPdu, CotpOptions } from './types';

const word = (bytes: Uint8Array, offset: number) => bytes[offset] * 256 + bytes[offset + 1];

/** Uncompressed CLNP. Failed checksums withhold addresses/options/payload; fragments stay raw. */
export function decodeClnp(bytes: Uint8Array, options: CotpOptions = {}): ClnpPdu | undefined {
	if (!(bytes instanceof Uint8Array) || bytes.length < 11 || bytes.length > 8192 || bytes[0] !== 0x81) return;
	const length = bytes[1],
		segmentLength = word(bytes, 5),
		type = bytes[4] & 31;
	if (length < 11 || length > 254 || length > bytes.length || bytes[2] !== 1 || segmentLength !== bytes.length) return;
	const segmentationPermitted = Boolean(bytes[4] & 128),
		more = Boolean(bytes[4] & 64);
	if (!validFlags(type, bytes[4])) return;
	const result: ClnpPdu = {
		protocol: 'CLNP',
		type: type === 28 ? 'Data' : 'Error Report',
		headerLength: length,
		segmentLength,
		lifetime: bytes[3] / 2,
		lifetimeUnit: 's',
		segmentationPermitted,
		more,
		errorReportRequested: Boolean(bytes[4] & 32),
		integrity: isoHeaderIntegrity(bytes.subarray(0, length)),
		raw: bytes.slice(),
	};
	if (result.integrity === 'failed') return result;
	const position = readAddresses(bytes, result);
	if (position === undefined) return;
	const optionOffset = readSegmentation(bytes, position, result);
	if (optionOffset === undefined) return;
	result.options = networkOptions(bytes.subarray(optionOffset, length));
	if (!result.options) return;
	result.payload = bytes.slice(length);
	decodeInner(result, options);
	return result;
}

function validFlags(type: number, flags: number): boolean {
	return [1, 28].includes(type) && !(!(flags & 128) && flags & 64) && !(type === 1 && flags & 0xe0);
}

function readAddresses(bytes: Uint8Array, result: ClnpPdu): number | undefined {
	let position = 9;
	const length = result.headerLength;
	const destinationLength = bytes[position++];
	if (!destinationLength || destinationLength > 20 || position + destinationLength >= length) return;
	result.destination = bytes.slice(position, position + destinationLength);
	position += destinationLength;
	const sourceLength = bytes[position++];
	if (!sourceLength || sourceLength > 20 || position + sourceLength > length) return;
	result.source = bytes.slice(position, position + sourceLength);
	position += sourceLength;
	return position;
}

function readSegmentation(bytes: Uint8Array, position: number, result: ClnpPdu): number | undefined {
	const length = result.headerLength;
	if (result.segmentationPermitted) {
		if (position + 6 > length) return;
		result.pduId = word(bytes, position);
		result.offset = word(bytes, position + 2);
		result.totalLength = word(bytes, position + 4);
		position += 6;
		const end = result.offset + bytes.length - length,
			totalData = result.totalLength - length;
		if (result.offset % 8 || totalData < 0 || end > totalData || (!result.more && end !== totalData)) return;
		if (result.more && (!(bytes.length - length > 0) || (bytes.length - length) % 8 || end >= totalData)) return;
	}
	return position;
}

function decodeInner(result: ClnpPdu, options: CotpOptions): void {
	const payload = result.payload!;
	if (result.integrity === 'verified' && result.type === 'Data' && !result.more && !result.offset) {
		if (payload[0] === 0x85) result.idrp = decodeIdrp(payload);
		else {
			const cotp = decodeCotp(payload, {
				...options,
				atnAddresses: { source: result.source!, destination: result.destination! },
			});
			if (cotp?.pdus.length) result.cotp = cotp;
		}
	}
}
