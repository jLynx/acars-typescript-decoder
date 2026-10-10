// Doc9705 Ed2 CMMessageSetVersion1 from pinned Wireshark, GPL-2.0-or-later.
import { Bits } from '@/payload/protocols/bits';
import { normallySmall, enumValue } from './acse-values';
import { perPayload } from './per';
import type { AtnCm, AtnCmAddress, AtnCmApplication, AtnCmDateTime } from './cm.types';

function text(bits: Bits, width: number, minimum: number, maximum: number): string {
	const count = bits.constrained(width, minimum, maximum);
	return Array.from({ length: count }, () => String.fromCharCode(bits.read(7))).join('');
}

function octets(bits: Bits, count: number): Uint8Array {
	return Uint8Array.from({ length: count }, () => bits.read(8));
}

function address(bits: Bits, long: boolean): AtnCmAddress {
	const routingDomainPart = long ? octets(bits, 5) : undefined;
	const reference = bits.read(1);
	const addressReference = reference ? octets(bits, 3) : undefined;
	const localSystemNselTsel = octets(bits, bits.read(1) + 10);
	return {
		format: long ? 'long-tsap' : 'short-tsap',
		...(routingDomainPart ? { routingDomainPart } : {}),
		...(addressReference ? { addressReference } : {}),
		localSystemNselTsel,
	};
}

function applications(bits: Bits, addressed: boolean): AtnCmApplication[] {
	const count = bits.read(8) + 1;
	return Array.from({ length: count }, () => ({
		aeQualifier: bits.read(8),
		version: bits.constrained(8, 1, 255),
		...(addressed ? { address: address(bits, bits.read(1) === 0) } : {}),
	}));
}

function dateTime(bits: Bits): AtnCmDateTime {
	const year = bits.constrained(7, 1996, 2095),
		month = bits.constrained(4, 1, 12),
		day = bits.constrained(5, 1, 31);
	const hour = bits.constrained(5, 0, 23),
		minute = bits.constrained(6, 0, 59);
	const calendarValid = new Date(Date.UTC(year, month - 1, day)).getUTCMonth() === month - 1;
	return { year, month, day, hour, minute, calendarValid };
}

function logon(bits: Bits, result: AtnCm): void {
	const flags = Array.from({ length: 6 }, () => bits.read(1));
	result.flightIdentification = text(bits, 3, 2, 8);
	result.address = address(bits, true);
	if (flags[0]) result.addressedApplications = applications(bits, true);
	if (flags[1]) result.otherApplications = applications(bits, false);
	if (flags[2]) result.facility = text(bits, 3, 4, 8);
	if (flags[3]) result.departure = text(bits, 0, 4, 4);
	if (flags[4]) result.destination = text(bits, 0, 4, 4);
	if (flags[5]) {
		result.departureDateTime = dateTime(bits);
		result.notes.push('CM departure date/time has no timezone; operational use requires bilateral agreement.');
		if (!result.departureDateTime.calendarValid)
			result.notes.push('Calendar date is invalid despite conforming individual ASN.1 fields.');
	}
}

function response(bits: Bits, result: AtnCm): void {
	const addressed = bits.read(1),
		other = bits.read(1);
	if (addressed) result.addressedApplications = applications(bits, true);
	if (other) result.otherApplications = applications(bits, false);
}

const abortReasons = [
	'Timer expired',
	'Undefined error',
	'Invalid PDU',
	'Protocol error',
	'Dialogue acceptance not permitted',
	'Dialogue end not accepted',
	'Communication service error',
	'Communication service failure',
	'Invalid QoS parameter',
	'Expected PDU missing',
];

function body(bits: Bits, result: AtnCm): void {
	const choice = result.direction === 'uplink' ? bits.constrained(3, 0, 5) : bits.constrained(2, 0, 2);
	const types: Array<AtnCm['type']> =
		result.direction === 'uplink'
			? ['logon-response', 'update', 'contact-request', 'forward-request', 'abort', 'forward-response']
			: ['logon-request', 'contact-response', 'abort'];
	result.type = types[choice];
	if (result.type === 'logon-request' || result.type === 'forward-request') logon(bits, result);
	else if (result.type === 'logon-response' || result.type === 'update') response(bits, result);
	else if (result.type === 'contact-request') {
		result.facility = text(bits, 3, 4, 8);
		result.address = address(bits, true);
	} else {
		const abort = result.type === 'abort';
		const code = abort
			? enumValue(bits, 10)
			: result.type === 'contact-response'
				? bits.read(1)
				: bits.constrained(2, 0, 2);
		const meanings = abort
			? abortReasons
			: result.type === 'contact-response'
				? ['Contact success', 'Contact not successful']
				: ['Success', 'Incompatible version', 'Service not supported'];
		result.response = { code, meaning: meanings[code] ?? 'Unassigned extension' };
	}
}

/** Decode CM version 1 with a known wire direction; retain opaque addresses. */
export function decodeAtnCm(bytes: Uint8Array, direction: 'uplink' | 'downlink', bitLength = bytes.length * 8): AtnCm {
	if (
		!(bytes instanceof Uint8Array) ||
		!bytes.length ||
		bytes.length > 8192 ||
		!Number.isInteger(bitLength) ||
		bitLength <= (bytes.length - 1) * 8 ||
		bitLength > bytes.length * 8
	)
		throw new RangeError('ATN CM requires 1–8192 bytes and a matching bit length');
	if (direction !== 'uplink' && direction !== 'downlink') throw new TypeError('ATN CM direction required');
	const bits = new Bits(bytes);
	const result: AtnCm = {
		protocol: 'ATN-CM',
		version: 1,
		direction,
		type: 'extension',
		raw: bytes.slice(),
		bitLength,
		consumedBits: 0,
		structureComplete: false,
		integrity: 'unverified',
		notes: [],
		source: {
			repository: 'https://github.com/wireshark/wireshark',
			revision: 'ad85ea3cb5af4e9665f1b3e3cda5bee94b71ab73',
			files: ['epan/dissectors/asn1/atn-cm/atn-cm.asn'],
		},
	};
	if (bits.read(1)) result.extension = { index: normallySmall(bits), payload: perPayload(bits, 8).payload };
	else body(bits, result);
	if (bits.position > bitLength) throw new Error('Truncated CM bit string');
	result.consumedBits = bits.position;
	result.structureComplete = bits.paddingOnly() && (bitLength === bytes.length * 8 || bits.position === bitLength);
	if (!result.structureComplete) result.notes.push('Unconsumed bytes or nonzero padding remain in raw.');
	return result;
}
