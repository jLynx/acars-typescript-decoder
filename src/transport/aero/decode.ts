// Aero R and P/T user-data SU layouts adapted from MIT jontio/JAERO aerol.cpp/h.
// Revision and original license in docs/upstreams.json and THIRD_PARTY_NOTICES.txt.
import { avlcCrc } from '@/transport/avlc';
import type { AeroSignalUnit } from './types';
import { readAeroControl } from './control';

export function decodeAeroSignalUnit(bytes: Uint8Array, channel: AeroSignalUnit['channel']): AeroSignalUnit {
	if (
		!['R', 'P', 'T'].includes(channel) ||
		!(bytes instanceof Uint8Array) ||
		bytes.length !== (channel === 'R' ? 19 : 12)
	)
		throw new RangeError('Invalid Aero signal unit/channel');
	const result: AeroSignalUnit = {
		protocol: 'Aero',
		channel,
		type: bytes[0],
		integrity: avlcCrc(bytes) === 0xf0b8 ? 'verified' : 'failed',
		raw: bytes.slice(),
		payload: new Uint8Array(),
	};
	if (result.integrity === 'failed') return result;
	if (channel === 'R') return readR(bytes, result);
	return readPT(bytes, result);
}

function readR(bytes: Uint8Array, result: AeroSignalUnit): AeroSignalUnit {
	if (!(bytes[1] & 8)) {
		result.type = bytes[2];
		result.payload = bytes.slice(3, -2);
		readAeroControl(result);
		return result;
	}
	const indicator = bytes[0] >>> 4,
		length = bytes[0] & 15;
	result.type = length;
	if (indicator < 1 || indicator > 6 || length < 1 || length > 11) {
		result.payload = bytes.slice(1, -2);
		return result;
	}
	const total = indicator === 1 ? 1 : indicator <= 3 ? 2 : 3;
	const sequence = indicator === 1 ? 0 : indicator <= 3 ? indicator - 2 : indicator - 4;
	if (sequence < total - 1 && length !== 11) throw new Error('Non-final Aero R SU requires 11 octets');
	Object.assign(result, {
		aircraft: bytes[2] * 65536 + bytes[3] * 256 + bytes[4],
		groundStation: bytes[5],
		queue: bytes[1] >>> 4,
		reference: bytes[1] & 7,
		total,
		sequence,
		lastLength: sequence === total - 1 ? length : 11,
		payload: bytes.slice(6, 6 + length),
	});
	return result;
}

function readPT(bytes: Uint8Array, result: AeroSignalUnit): AeroSignalUnit {
	if (bytes[0] === 0x71) {
		const lastLength = bytes[7] >>> 4,
			total = bytes[6] & 63;
		if (lastLength > 8 || total < 1) throw new Error('Invalid Aero P/T user-data length/count');
		Object.assign(result, {
			aircraft: bytes[1] * 65536 + bytes[2] * 256 + bytes[3],
			groundStation: bytes[4],
			queue: bytes[5] >>> 4,
			reference: bytes[5] & 15,
			total,
			sequence: total,
			lastLength,
			payload: bytes.slice(8, 10),
		});
	} else if ((bytes[0] & 0xc0) === 0xc0) {
		Object.assign(result, {
			sequence: bytes[0] & 63,
			queue: bytes[1] >>> 4,
			reference: bytes[1] & 15,
			payload: bytes.slice(2, 10),
		});
	} else {
		result.payload = bytes.slice(1, -2);
		readAeroControl(result);
	}
	return result;
}
