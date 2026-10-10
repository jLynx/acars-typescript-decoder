// AVLC link fields adapted from MIT xoolive/datalink decode/avlc.rs.
import type { AcarsReport } from '@/types';
import { acarsCrc } from '@/framing/framing';
import { decodeAcars } from '@/framing/messages';
import type { AvlcControl, AvlcFrame } from './types';
import { decodeAvlcAddress } from './address';
import { decodeXid } from './xid';
import { decodeX25 } from './network/x25';

/** CRC-16/X-25 running remainder; full frames have residual F0B8. */
export function avlcCrc(bytes: Uint8Array): number {
	let crc = 0xffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0x8408 : 0);
	}
	return crc;
}

function control(byte: number): AvlcControl {
	const pollFinal = Boolean(byte & 16);
	if (!(byte & 1)) return { type: 'I', sendSequence: (byte >>> 1) & 7, receiveSequence: byte >>> 5, pollFinal };
	if ((byte & 3) === 1)
		return {
			type: 'S',
			function: (['RR', 'RNR', 'REJ', 'SREJ'] as const)[(byte >>> 2) & 3],
			receiveSequence: byte >>> 5,
			pollFinal,
		};
	const code = (byte >>> 2) & 0x3b;
	const names: Record<number, string> = {
		0: 'UI',
		3: 'DM',
		16: 'DISC',
		24: 'UA',
		33: 'FRMR',
		43: 'XID',
		44: 'SABM',
		56: 'TEST',
	};
	return { type: 'U', function: names[code] ?? 'Unknown', code, pollFinal };
}

/** Already destuffed AVLC bytes, including two FCS bytes, excluding HDLC flags. */
export function decodeAvlc(bytes: Uint8Array): AvlcFrame {
	if (!(bytes instanceof Uint8Array) || bytes.length < 11 || bytes.length > 8192)
		throw new RangeError('AVLC frame must contain 11–8192 bytes including FCS');
	if (bytes[3] & 1 || !(bytes[7] & 1)) throw new Error('Invalid AVLC address extension bits');
	const result: AvlcFrame = {
		protocol: 'AVLC',
		destination: decodeAvlcAddress(bytes.slice(0, 4)),
		source: decodeAvlcAddress(bytes.slice(4, 8)),
		control: control(bytes[8]),
		integrity: avlcCrc(bytes) === 0xf0b8 ? 'verified' : 'failed',
		raw: bytes.slice(),
	};
	if (result.integrity !== 'verified') return result;
	const payload = bytes.slice(9, -2);
	if (result.control.type === 'I') {
		const acars = payload.length >= 3 && payload[0] === 255 && payload[1] === 255 && payload[2] === 1;
		result.payload = { kind: acars ? 'acars' : 'x25', bytes: payload };
		if (acars) {
			const report = decodeTransportAcars(payload.slice(3));
			const direction =
				result.source.kind === 'aircraft' ? 'downlink' : result.source.kind === 'ground' ? 'uplink' : undefined;
			if (report && direction === report.direction) result.payload.acars = report;
			else result.payload.kind = 'unknown';
		} else result.payload.x25 = decodeX25(payload);
	} else if (result.control.type === 'U' && result.control.function === 'XID')
		result.payload = {
			kind: 'xid',
			bytes: payload,
			xid: decodeXid(payload, result.source.status, result.control.pollFinal),
		};
	return result;
}

/** Transport ACARS bytes from mode through BCS + DEL; parity and inner BCS must both pass. */
export function decodeTransportAcars(bytes: Uint8Array): AcarsReport | undefined {
	if (bytes.length < 16 || bytes.length > 243 || bytes.at(-1) !== 0x7f || acarsCrc(bytes.subarray(0, -1)) !== 0) return;
	return decodeAcars(bytes.subarray(0, -3));
}
