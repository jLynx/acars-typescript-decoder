// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from dumpvdl2 atn.c; Copyright 2017–2026 Tomasz Lemiech. See THIRD_PARTY_NOTICES.txt.
import type { AtnSecurityLabel } from '@/transport/network/types';

export function decodeAtnSecurityLabel(bytes: Uint8Array): AtnSecurityLabel {
	if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 65535)
		throw new RangeError('Invalid security label');
	const registrationLength = bytes[0];
	if (registrationLength + 1 > bytes.length) throw new Error('Truncated security registration');
	const result: AtnSecurityLabel = {
		registration: bytes.slice(1, registrationLength + 1),
		tags: [],
		unconsumed: new Uint8Array(),
		coverage: 'decoded',
	};
	let position = registrationLength + 1;
	if (position === bytes.length) return result;
	const length = bytes[position++],
		end = position + length;
	if (end > bytes.length) throw new Error('Truncated security information');
	while (position < end) {
		const nameLength = bytes[position++];
		if (!nameLength || position + nameLength >= end) throw new Error('Truncated security tag name');
		const name = bytes.slice(position, position + nameLength);
		position += nameLength;
		const valueLength = bytes[position++];
		if (position + valueLength > end) throw new Error('Truncated security tag value');
		const tag = { name, raw: bytes.slice(position, position + valueLength) };
		position += valueLength;
		const decoded = decodeTag(tag);
		if (!decoded || (decoded.traffic && !decoded.traffic.type)) result.coverage = 'partial';
		result.tags.push(decoded ?? tag);
	}
	result.unconsumed = bytes.slice(end);
	if (result.unconsumed.length) result.coverage = 'partial';
	return result;
}

function decodeTag(tag: AtnSecurityLabel['tags'][number]): AtnSecurityLabel['tags'][number] | undefined {
	if (tag.name.length !== 1) return;
	const id = tag.name[0],
		raw = tag.raw;
	if ([3, 6, 7].includes(id)) {
		if (raw.length !== 1) throw new Error('Invalid security scalar length');
		return { ...tag, value: raw[0], allowNonAtsc: id === 7 ? true : id === 6 ? false : undefined };
	}
	if (id === 5) {
		if (raw.length !== 2) throw new Error('Invalid security subnetwork length');
		return { ...tag, subnetwork: { id: raw[0], permittedTraffic: raw[1] } };
	}
	if (id === 15) {
		if (raw.length !== 1) throw new Error('Invalid traffic-type length');
		const kind = raw[0] >>> 5;
		const type =
			raw[0] === 0x30
				? 'administrative'
				: [0, 1].includes(kind)
					? 'operational'
					: kind === 3
						? 'system-management'
						: undefined;
		const category = type === 'operational' ? (kind === 0 ? 'ATSC' : 'AOC') : undefined;
		return { ...tag, traffic: { type, category, routePolicy: raw[0] & 31 } };
	}
}
