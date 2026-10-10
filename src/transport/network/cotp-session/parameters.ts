import type { CotpPdu, CotpTiming } from '@/transport/network/types';

export function parameter(pdu: CotpPdu, id: number): Uint8Array | undefined {
	return pdu.parameters
		.slice()
		.reverse()
		.find((part) => part.id === id)?.raw;
}

export function integer(pdu: CotpPdu, id: number, length: number): number | undefined {
	const raw = parameter(pdu, id);
	if (!raw) return;
	if (raw.length !== length) throw new Error('Invalid connection/control parameter length.');
	let value = 0;
	for (const byte of raw) value = value * 256 + byte;
	return value;
}

/** X.224 §13.3.4 i), o): these are per-peer indications, never local capture timers. */
export function timing(pdu: CotpPdu): CotpTiming {
	return { acknowledgementMs: integer(pdu, 0x85, 2), inactivityMs: integer(pdu, 0xf2, 4) };
}
