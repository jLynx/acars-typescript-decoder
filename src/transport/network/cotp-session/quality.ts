// Independent X.224 (11/1995) §13.3.4 QoS and user-defined protection indications.
import type { CotpPdu, CotpQuality } from '@/transport/network/types';
import { integer, parameter } from './parameters';

function sized(pdu: CotpPdu, id: number, lengths: number[]): Uint8Array | undefined {
	const bytes = parameter(pdu, id);
	if (bytes && !lengths.includes(bytes.length)) throw new Error('Invalid quality parameter length.');
	return bytes;
}

export function quality(pdu: CotpPdu): CotpQuality {
	const residual = sized(pdu, 0x86, [3]);
	const throughput = sized(pdu, 0x89, [12, 24]);
	const delay = sized(pdu, 0x88, [8]);
	const alternatives = parameter(pdu, 0xc7);
	if (alternatives && (!alternatives.length || alternatives.some((byte) => (byte & 15) !== 0 || byte > 0x40)))
		throw new Error('Invalid alternative protocol classes.');
	return {
		protection: parameter(pdu, 0xc5)?.slice(),
		priority: integer(pdu, 0x87, 2),
		reassignmentSeconds: integer(pdu, 0x8b, 2),
		alternativeClasses: [...(alternatives ?? [])].map((byte) => byte >>> 4),
		residualError: residual && {
			targetExponent: residual[0],
			minimumExponent: residual[1],
			tsduSizeExponent: residual[2],
		},
		throughput: throughput && {
			maximum: words(throughput.subarray(0, 12), 3),
			average: words(throughput.length === 24 ? throughput.subarray(12) : throughput, 3),
			unit: 'octets/s',
		},
		transitDelay: delay && { values: words(delay, 2), unit: 'ms', tsduBytes: 128 },
	};
}

function words(bytes: Uint8Array, width: number): number[] {
	return Array.from({ length: bytes.length / width }, (_, index) =>
		bytes.subarray(index * width, (index + 1) * width).reduce((value, byte) => value * 256 + byte, 0),
	);
}
