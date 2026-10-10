// Satellite ACARS envelope offsets cross-checked with pinned JAERO ParserISU.
// Independent strict parity/BCS validation; satellite downlinks do not imply the VHF ten-byte text prefix.
import type { AcarsReport } from '@/types';
import type { AeroReception } from './types';
import { acarsCrc, oddParity } from '@/framing/framing';

export function decodeAeroAcars(bytes: Uint8Array, direction: AeroReception['direction']): AcarsReport | undefined {
	if (
		bytes.length < 19 ||
		bytes.length > 246 ||
		bytes[0] !== 255 ||
		bytes[1] !== 255 ||
		bytes[2] !== 1 ||
		bytes.at(-1) !== 127
	)
		return;
	const protectedBytes = bytes.subarray(3, -3);
	if (!protectedBytes.every(oddParity) || acarsCrc(bytes.subarray(3, -1)) !== 0) return;
	const plain = protectedBytes.map((value) => value & 127),
		end = plain.at(-1);
	if (![3, 23].includes(end!) || !(plain[12] === 2 || (plain.length === 13 && plain[12] === 3))) return;
	const text = (start: number, finish: number) => String.fromCharCode(...plain.subarray(start, finish));
	const registration = text(1, 8)
		.replace(/^\.+|\.+$/g, '')
		.trim();
	if (!registration || !/^[\x20-\x7e]{1,7}$/.test(registration)) return;
	return {
		mode: text(0, 1),
		registration,
		acknowledgement: plain[8] === 21 ? 'NAK' : text(8, 9),
		label: text(9, 11).replace(/\x7f/g, 'd'),
		blockId: text(11, 12),
		direction,
		text: plain[12] === 2 ? text(13, plain.length - 1) : '',
		continuation: end === 23,
	};
}
