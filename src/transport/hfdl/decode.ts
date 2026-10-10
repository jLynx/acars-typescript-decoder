// HFDL PDU layouts adapted from MIT xoolive/datalink hfdl.rs, pinned in docs/upstreams.json.
import { avlcCrc, decodeTransportAcars } from '@/transport/avlc';
import { decodeHfdlReport } from './reports';
import type { HfdlFrame, HfdlLpdu, HfdlMpdu, HfdlSpdu, Hfnpdu } from './types';

/** Already-demodulated HFDL PDU bytes. A failed MPDU header CRC withholds all contained LPDUs. */
export function decodeHfdl(bytes: Uint8Array): HfdlFrame {
	if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 8192)
		throw new RangeError('HFDL PDU must contain 1–8192 bytes');
	const result: HfdlFrame = {
		protocol: 'HFDL',
		type: bytes[0] & 1 ? 'MPDU' : 'SPDU',
		integrity: 'failed',
		raw: bytes.slice(),
		unconsumed: new Uint8Array(),
	};
	if (result.type === 'SPDU') {
		if (bytes.length < 66) throw new RangeError('Truncated HFDL SPDU');
		if (avlcCrc(bytes.subarray(0, 66)) === 0xf0b8) {
			result.integrity = 'verified';
			result.spdu = spdu(bytes);
		}
		result.unconsumed = bytes.slice(66);
		return result;
	}
	const { headerLength, mpdu } = mpduHeader(bytes);
	if (headerLength + 2 > bytes.length) throw new RangeError('Truncated HFDL MPDU header');
	if (avlcCrc(bytes.subarray(0, headerLength + 2)) !== 0xf0b8) return result;
	result.integrity = 'verified';
	let position = headerLength + 2;
	for (const aircraft of mpdu.aircraft) {
		for (const [index, length] of aircraft.lengths.entries()) {
			const raw = bytes.slice(position, position + length);
			const lpdu: HfdlLpdu = { index, raw, integrity: 'incomplete' };
			if (raw.length === length && length >= 3) Object.assign(lpdu, decodeLpdu(raw, mpdu.direction));
			aircraft.lpdus.push(lpdu);
			position += length;
		}
	}
	result.mpdu = mpdu;
	result.unconsumed = bytes.slice(position);
	return result;
}

function spdu(bytes: Uint8Array): HfdlSpdu {
	const change = bytes[0] >>> 6;
	return {
		groundStation: bytes[1] & 127,
		version: (bytes[0] >>> 2) & 3,
		rlsInUse: Boolean(bytes[0] & 2),
		iso8208Supported: Boolean(bytes[0] & 32),
		change,
		changeName: ['None', 'Channel down', 'Upcoming frequency change', 'Ground station down'][change],
		tdmaFrameIndex: bytes[2] + (bytes[3] & 15) * 256,
		tdmaFrameOffset: bytes[3] >>> 4,
		minimumPriority: bytes[52] & 15,
		systemTableVersion: bytes[53] + (bytes[54] & 15) * 256,
		slotsRaw: bytes.slice(4, 52),
		stations: [
			{
				id: bytes[1] & 127,
				utcSynchronized: Boolean(bytes[1] & 128),
				frequenciesInUseMask: (bytes[54] >>> 4) + bytes[55] * 16 + bytes[56] * 4096,
			},
			{
				id: bytes[57] & 127,
				utcSynchronized: Boolean(bytes[57] & 128),
				frequenciesInUseMask: bytes[58] + bytes[59] * 256 + (bytes[60] & 15) * 65536,
			},
			{
				id: (bytes[60] >>> 4) + (bytes[61] & 7) * 16,
				utcSynchronized: Boolean(bytes[61] & 8),
				frequenciesInUseMask: (bytes[61] >>> 4) + bytes[62] * 16 + bytes[63] * 4096,
			},
		],
	};
}

function mpduHeader(bytes: Uint8Array): { headerLength: number; mpdu: HfdlMpdu } {
	if (bytes.length < 5) throw new RangeError('Truncated HFDL MPDU');
	const mpdu: HfdlMpdu = {
		direction: bytes[0] & 2 ? 'downlink' : 'uplink',
		groundStation: bytes[1] & 127,
		aircraft: [],
	};
	if (mpdu.direction === 'downlink') {
		const count = (bytes[0] >>> 2) & 15;
		if (bytes.length < 8 + count) throw new RangeError('Truncated HFDL downlink lengths');
		mpdu.aircraft.push({
			id: bytes[2],
			lengths: [...bytes.slice(6, 6 + count)].map((length) => length + 1),
			lpdus: [],
		});
		return { headerLength: 6 + count, mpdu };
	}
	let position = 2;
	const count = ((bytes[0] >>> 4) & 7) + 1;
	for (let index = 0; index < count; index++) {
		if (position + 2 > bytes.length) throw new RangeError('Truncated HFDL uplink aircraft header');
		const id = bytes[position++],
			lpduCount = bytes[position++] >>> 4;
		if (position + lpduCount > bytes.length) throw new RangeError('Truncated HFDL uplink lengths');
		mpdu.aircraft.push({
			id,
			lengths: [...bytes.slice(position, position + lpduCount)].map((length) => length + 1),
			lpdus: [],
		});
		position += lpduCount;
	}
	return { headerLength: position, mpdu };
}

function decodeLpdu(bytes: Uint8Array, direction: HfdlMpdu['direction']): Omit<HfdlLpdu, 'raw' | 'index'> {
	if (avlcCrc(bytes) !== 0xf0b8) return { integrity: 'failed' };
	const body = bytes.subarray(0, -2),
		type = body[0];
	const names: Record<number, string> = {
		0x0d: 'Unnumbered data',
		0x1d: 'Unnumbered acked data',
		0x2f: 'Logon denied',
		0x3f: 'Logoff request',
		0x4f: 'Logon resume',
		0x5f: 'Logon resume confirm',
		0x8f: 'Logon request normal',
		0x9f: 'Logon confirm',
		0xbf: 'Logon request DLS',
	};
	const result: Omit<HfdlLpdu, 'raw' | 'index'> = { integrity: 'verified', type, typeName: names[type] ?? 'Unknown' };
	if ([0x0d, 0x1d].includes(type)) result.hfnpdu = hfnpdu(body.slice(1), direction);
	else if ([0x2f, 0x3f, 0x4f, 0x5f, 0x8f, 0x9f, 0xbf].includes(type) && body.length >= 4) {
		result.icaoAddress = body[1] * 65536 + body[2] * 256 + body[3];
		if ([0x2f, 0x3f].includes(type) && body.length >= 5) result.reason = body[4];
		if ([0x5f, 0x9f].includes(type) && body.length >= 5) result.aircraftId = body[4];
	}
	return result;
}

function hfnpdu(bytes: Uint8Array, direction: HfdlMpdu['direction']): Hfnpdu | undefined {
	if (bytes.length < 2 || bytes[0] !== 255) return;
	const type = bytes[1];
	const names: Record<number, string> = {
		0xd0: 'System table partial',
		0xd1: 'Performance data',
		0xd2: 'System table request',
		0xd5: 'Frequency data',
		0xde: 'Delayed echo',
		0xff: 'Enveloped data',
	};
	const result: Hfnpdu = { type, typeName: names[type] ?? 'Unknown', raw: bytes };
	if (type === 0xd0 && bytes.length >= 5) {
		const total = (bytes[2] >>> 4) + 1,
			sequence = bytes[2] & 15;
		if (sequence < total) result.systemTable = { total, sequence, version: (bytes[3] >>> 4) + bytes[4] * 16 };
	} else if (type === 0xd2 && bytes.length === 4) result.requestData = bytes[2] + bytes[3] * 256;
	else if ([0xd1, 0xd5].includes(type)) result.report = decodeHfdlReport(bytes);
	else if (type === 255) {
		const acars = decodeTransportAcars(bytes.subarray(2));
		if (acars?.direction === direction) result.acars = acars;
	}
	return result;
}
