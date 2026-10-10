// SPDX-License-Identifier: GPL-2.0-or-later
// ATN extended checksum pseudo-trailer adapted from Wireshark packet-osi.c, pinned in docs/upstreams.json.
// Laurent Deniel, Ralf Schneider; Copyright 1998 Gerald Combs. Original notice in THIRD_PARTY_NOTICES.txt.
import type { CotpOptions, CotpPdu } from '@/transport/network/types';

/** ATN 16/32-bit extended checksums: zero effective checksum fields, append destination then source and stored ATN value. */
export function atnTransportIntegrity(
	bytes: Uint8Array,
	pdu: CotpPdu,
	addresses: CotpOptions['atnAddresses'],
): CotpPdu['atnIntegrity'] {
	const offsets = new Map<number, { offset: number; length: number }>();
	let offset = bytes[0] + 1 - pdu.parameters.reduce((sum, part) => sum + part.raw.length + 2, 0);
	for (const part of pdu.parameters) {
		offsets.set(part.id, { offset: offset + 2, length: part.raw.length });
		offset += part.raw.length + 2;
	}
	const ids = [8, 9].filter((id) => offsets.has(id));
	if (!ids.length) return;
	if (ids.length !== 1) return 'failed';
	const id = ids[0],
		field = offsets.get(id)!,
		width = id === 8 ? 4 : 2;
	if (field.length !== width) return 'failed';
	if (!addresses) return 'unverified';
	for (const address of [addresses.source, addresses.destination])
		if (!(address instanceof Uint8Array) || address.length < 1 || address.length > 20)
			throw new RangeError('Invalid ATN checksum NSAP address');
	const protectedBytes = bytes.slice();
	protectedBytes.fill(0, field.offset, field.offset + width);
	const iso = offsets.get(0xc3);
	if (iso) {
		if (iso.length !== 2) return 'failed';
		protectedBytes.fill(0, iso.offset, iso.offset + 2);
	}
	const trailer = Uint8Array.from([
		addresses.destination.length,
		...addresses.destination,
		addresses.source.length,
		...addresses.source,
		...bytes.slice(field.offset, field.offset + width),
	]);
	const sums = new Array<number>(width).fill(0);
	for (const byte of [...protectedBytes, ...trailer]) {
		sums[0] = (sums[0] + byte) % 255;
		for (let index = 1; index < width; index++) sums[index] = (sums[index] + sums[index - 1]) % 255;
	}
	return sums.every((value) => value === 0) ? 'verified' : 'failed';
}
