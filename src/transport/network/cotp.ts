// COTP fixed fields and parameter identifiers adapted from MIT xoolive/datalink x25.rs.
import type { CotpOptions, CotpParameter, CotpPdu, CotpResult } from './types';
import { cotpInputLimit, preferredTpduSize } from './cotp-size';
import { atnTransportIntegrity } from './atn/integrity';

const word = (bytes: Uint8Array, offset: number) => bytes[offset] * 256 + bytes[offset + 1];
const names: Record<number, string> = {
	0xe0: 'Connect Request',
	0xd0: 'Connect Confirm',
	0x80: 'Disconnect Request',
	0xc0: 'Disconnect Confirm',
	0xf0: 'Data',
	0x10: 'Expedited Data',
	0x60: 'Data Ack',
	0x20: 'Expedited Data Ack',
	0x50: 'Reject',
	0x70: 'Error',
};

/** Parses bounded class-4 transport headers; user data remains raw until ATN/integrity decoding exists. */
export function decodeCotp(bytes: Uint8Array, options: CotpOptions = {}): CotpResult | undefined {
	const maximum = cotpInputLimit(options.maxNsduBytes);
	if (!(bytes instanceof Uint8Array) || bytes.length < 2 || bytes.length > maximum) return;
	const result: CotpResult = {
		protocol: 'COTP',
		coverage: 'headers',
		integrity: 'unverified',
		pdus: [],
		raw: bytes.slice(),
		unconsumed: new Uint8Array(),
	};
	let position = 0;
	while (position < bytes.length && result.pdus.length < 128) {
		const length = bytes[position];
		if (!length || length === 255 || position + 1 + length > bytes.length) break;
		const header = bytes.slice(position + 1, position + 1 + length);
		const pdu = readHeader(header, options);
		if (!pdu) break;
		const start = position;
		position += 1 + length;
		result.pdus.push(pdu);
		if ([0xe0, 0xd0, 0x80, 0xf0, 0x10].includes(pdu.type)) {
			if (position < bytes.length) pdu.userData = bytes.slice(position);
			position = bytes.length;
			pdu.integrity = transportIntegrity(bytes.subarray(start, position), pdu);
			pdu.atnIntegrity = atnTransportIntegrity(bytes.subarray(start, position), pdu, options.atnAddresses);
			break;
		}
		pdu.integrity = transportIntegrity(bytes.subarray(start, position), pdu);
		pdu.atnIntegrity = atnTransportIntegrity(bytes.subarray(start, position), pdu, options.atnAddresses);
	}
	result.unconsumed = bytes.slice(position);
	if (result.unconsumed.length || result.pdus.some((pdu) => pdu.parameters.some((p) => p.name === 'Unknown')))
		result.coverage = 'partial';
	result.integrity = result.pdus.some((pdu) => pdu.integrity === 'failed')
		? 'failed'
		: result.pdus.length && !result.unconsumed.length && result.pdus.every((pdu) => pdu.integrity === 'verified')
			? 'verified'
			: 'unverified';
	return result;
}

/** RFC 905 §§6.17, 13.2.3.1: Fletcher over LI, fixed/variable header and data of each TPDU separately. */
function transportIntegrity(bytes: Uint8Array, pdu: CotpPdu): CotpPdu['integrity'] {
	const checksum = pdu.parameters
		.slice()
		.reverse()
		.find((parameter) => parameter.id === 0xc3);
	if (!checksum) return 'unverified';
	if (checksum.raw.length !== 2) return 'failed';
	let sum = 0,
		weighted = 0;
	for (const byte of bytes) {
		sum = (sum + byte) % 255;
		weighted = (weighted + sum) % 255;
	}
	return !sum && !weighted ? 'verified' : 'failed';
}

function readHeader(header: Uint8Array, options: CotpOptions): CotpPdu | undefined {
	if (header.length < 3) return;
	const high = header[0] & 0xf0;
	const type = [0xe0, 0xd0, 0x60, 0x50].includes(high) ? high : high === 0xf0 ? header[0] & 0xfe : header[0];
	if (!names[type]) return;
	const result: CotpPdu = {
		type,
		typeName: names[type],
		destinationReference: word(header, 1),
		integrity: 'unverified',
		rawHeader: header,
		parameters: [],
	};
	let fixed: number;
	if ([0xe0, 0xd0, 0x80].includes(type)) {
		if (header.length < 6) return;
		result.sourceReference = word(header, 3);
		if (type === 0x80) result.disconnectReason = header[5];
		else {
			result.protocolClass = header[5] >>> 4;
			result.options = header[5] & 15;
			result.credit = header[0] & 15;
		}
		fixed = 6;
	} else if (type === 0xc0) {
		if (header.length < 5) return;
		result.sourceReference = word(header, 3);
		fixed = 5;
	} else if (type === 0x70) {
		if (header.length < 4) return;
		result.rejectCause = header[3];
		fixed = 4;
	} else {
		fixed = sequenceFields(header, result, options);
		if (!fixed) return;
	}
	const parameters = readParameters(header.subarray(fixed));
	if (!parameters) return;
	if (type === 0x70) for (const part of parameters) if (part.id === 0xc1) part.name = 'Invalid TPDU';
	result.parameters = parameters;
	return result;
}

function sequenceFields(header: Uint8Array, result: CotpPdu, options: CotpOptions): number {
	const acknowledgement = [0x60, 0x20, 0x50].includes(result.type);
	const extendedSize = [0x60, 0x50].includes(result.type) ? 9 : 7;
	// Header-length parity is not reliable once optional TLVs are present. Require a unique valid layout.
	const normal = header.length >= 4 && readParameters(header.subarray(4)) !== undefined;
	const extended = header.length >= extendedSize && readParameters(header.subarray(extendedSize)) !== undefined;
	const format = options.format ?? (normal !== extended ? (normal ? 'normal' : 'extended') : undefined);
	if (!format || (format === 'normal' ? !normal : !extended)) return 0;
	result.format = format;
	const sequence =
		format === 'normal'
			? header[3] & 127
			: new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(3) & 0x7fffffff;
	if (acknowledgement) result.receiveSequence = sequence;
	else {
		result.sendSequence = sequence;
		result.endOfTransmission = Boolean(header[3] & 128);
		if (result.type === 0xf0) result.requestAcknowledgement = Boolean(header[0] & 1);
	}
	if ([0x60, 0x50].includes(result.type)) result.credit = format === 'normal' ? header[0] & 15 : word(header, 7);
	return format === 'normal' ? 4 : extendedSize;
}

function readParameters(bytes: Uint8Array): CotpParameter[] | undefined {
	const result: CotpParameter[] = [];
	let position = 0;
	while (position < bytes.length) {
		if (position + 2 > bytes.length) return;
		const id = bytes[position++],
			length = bytes[position++];
		if (position + length > bytes.length) return;
		result.push(parameter(id, bytes.slice(position, position + length)));
		position += length;
	}
	return result;
}

function parameter(id: number, raw: Uint8Array): CotpParameter {
	const parameterNames: Record<number, string> = {
		8: 'ATN extended checksum (32-bit)',
		9: 'ATN extended checksum (16-bit)',
		0x85: 'Acknowledgement time',
		0x86: 'Residual error rate',
		0x87: 'Priority',
		0x88: 'Transit delay',
		0x89: 'Throughput',
		0x8a: 'Subsequence number',
		0x8b: 'Reassignment time',
		0x8c: 'Flow control',
		0x8f: 'Selective acknowledgement',
		0x90: 'Expedited data sequence dependency',
		0xc0: 'TPDU size',
		0xc1: 'Calling transport selector',
		0xc2: 'Called transport selector',
		0xc3: 'Checksum',
		0xc4: 'Version number',
		0xc5: 'Protection',
		0xc6: 'Additional options',
		0xc7: 'Alternative protocol classes',
		0xf0: 'Preferred maximum TPDU size',
		0xf2: 'Inactivity timer',
	};
	const result: CotpParameter = { id, name: parameterNames[id] ?? 'Unknown', raw };
	if ([0x85, 0x87, 0x8a, 0x8b].includes(id) && raw.length === 2) result.value = word(raw, 0);
	if (id === 0xf2 && raw.length === 4) result.value = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0);
	if (id === 0xc0 && raw.length === 1 && raw[0] >= 7 && raw[0] <= 13) result.value = 2 ** raw[0];
	if (id === 0xf0) result.value = preferredTpduSize(raw);
	if ([0xc4, 0xc6].includes(id) && raw.length === 1) result.value = raw[0];
	if (result.value !== undefined) {
		if ([0x85, 0xf2].includes(id)) result.unit = 'ms';
		if (id === 0x8b) result.unit = 's';
		if ([0xc0, 0xf0].includes(id)) result.unit = 'bytes';
	}
	return result;
}
