// SPDX-License-Identifier: GPL-3.0-or-later
// RD_PATH layout adapted from dumpvdl2 idrp.c; Copyright 2017–2026 Tomasz Lemiech.
import type { IdrpAttribute } from '@/transport/network/types';
import { decodeAtnSecurityLabel } from '@/transport/network/atn/security';

export function decodeIdrpAttribute(result: IdrpAttribute): void {
	const { id, raw } = result;
	try {
		if ([7, 13, 15, 16].includes(id)) {
			if (raw.length !== 1) throw new Error('IDRP scalar requires one octet');
			result.value = raw[0];
		}
		if (id === 1) {
			if (raw.length !== 5) throw new Error('Invalid IDRP route separator');
			result.value = {
				routeId: raw.subarray(0, 4).reduce((sum, byte) => sum * 256 + byte, 0),
				localPreference: raw[4],
			};
		}
		if (id === 3) result.rdPath = path(raw);
		if (id === 14) result.security = decodeAtnSecurityLabel(raw);
	} catch (error) {
		result.reason = error instanceof Error ? error.message : 'Invalid IDRP attribute';
	}
}

function path(raw: Uint8Array): NonNullable<IdrpAttribute['rdPath']> {
	const result: NonNullable<IdrpAttribute['rdPath']> = [];
	let position = 0;
	while (position < raw.length) {
		if (position + 3 > raw.length) throw new Error('Truncated RD_PATH segment');
		const type = raw[position++],
			length = raw[position++] * 256 + raw[position++];
		const end = position + length,
			identifiers: Uint8Array[] = [];
		if (!length || end > raw.length) throw new Error('Invalid RD_PATH segment length');
		const segment = raw.slice(position, end);
		if (type >= 1 && type <= 4)
			while (position < end) {
				const count = raw[position++];
				if (!count || position + count > end) throw new Error('Invalid RD_PATH identifier');
				identifiers.push(raw.slice(position, position + count));
				position += count;
			}
		position = end;
		result.push({
			type,
			name: ['Unknown', 'RD_SET', 'RD_SEQ', 'ENTRY_SEQ', 'ENTRY_SET'][type] ?? 'Unknown',
			identifiers,
			raw: segment,
		});
	}
	return result;
}
