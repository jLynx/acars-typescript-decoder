// SPDX-License-Identifier: GPL-3.0-or-later
// IDRP body layouts adapted from dumpvdl2 src/idrp.c, revision in docs/upstreams.json.
// Copyright (c) 2017–2026 Tomasz Lemiech. Bounds/count validation is locally authored.
import type { IdrpAttribute, IdrpHeader, IdrpOpen, IdrpUpdate } from '@/transport/network/types';
import { decodeIdrpAttribute } from './attributes';

class Reader {
	position = 0;
	constructor(readonly bytes: Uint8Array) {}
	take(length: number): Uint8Array {
		if (this.position + length > this.bytes.length) throw new Error('Truncated IDRP body.');
		const result = this.bytes.slice(this.position, this.position + length);
		this.position += length;
		return result;
	}
	integer(width: number): number {
		return this.take(width).reduce((sum, byte) => sum * 256 + byte, 0);
	}
	remaining(): Uint8Array {
		return this.take(this.bytes.length - this.position);
	}
}

export function decodeIdrpBody(result: IdrpHeader): void {
	result.validation = result.raw.slice(14, 30);
	result.integrity = 'unverified';
	result.coverage = 'partial';
	try {
		const reader = new Reader(result.payload);
		if (result.type === 1) result.open = open(reader);
		else if (result.type === 2) result.update = update(reader);
		else if (result.type === 3) {
			const code = reader.integer(1),
				subcode = reader.integer(1);
			result.error = {
				code,
				subcode,
				data: reader.remaining(),
				relatedType: code === 4 ? subcode >>> 4 : undefined,
				state: code === 4 ? subcode & 15 : undefined,
			};
		} else if ([4, 5].includes(result.type)) {
			if (result.payload.length) throw new Error('Unexpected IDRP control body.');
			result.coverage = 'decoded';
		} else result.reason = 'Unsupported IDRP body retained raw.';
	} catch (error) {
		delete result.open;
		delete result.update;
		delete result.error;
		result.reason = error instanceof Error ? error.message : 'Invalid IDRP body.';
	}
}

function open(reader: Reader): IdrpOpen {
	const version = reader.integer(1);
	if (version !== 1) throw new Error('Unsupported IDRP version.');
	const holdingTime = reader.integer(2),
		maxPduSize = reader.integer(2),
		sourceRdi = reader.take(reader.integer(1));
	const count = reader.integer(1),
		ribAttributeSets: IdrpAttribute[][] = [];
	for (let index = 0; index < count; index++) {
		const attributes: IdrpAttribute[] = [],
			length = reader.integer(1);
		for (let i = 0; i < length; i++) {
			const id = reader.integer(1);
			const hasValue = [11, 14].includes(id);
			attributes.push(attribute(id, hasValue ? reader.take(reader.integer(2)) : new Uint8Array(), hasValue));
		}
		ribAttributeSets.push(attributes);
	}
	const confederations: Uint8Array[] = [],
		confCount = reader.integer(1);
	for (let index = 0; index < confCount; index++) confederations.push(reader.take(reader.integer(1)));
	const authentication = reader.integer(1);
	return {
		version,
		holdingTime,
		holdingTimeUnit: 's',
		maxPduSize,
		sourceRdi,
		ribAttributeSets,
		confederations,
		authentication,
		authenticationData: reader.remaining(),
	};
}

function update(reader: Reader): IdrpUpdate {
	const withdrawnRoutes: number[] = [],
		count = reader.integer(2);
	for (let i = 0; i < count; i++) withdrawnRoutes.push(reader.integer(4));
	const attributeReader = new Reader(reader.take(reader.integer(2))),
		attributes: IdrpAttribute[] = [];
	while (attributeReader.position < attributeReader.bytes.length) {
		const flags = attributeReader.integer(1),
			id = attributeReader.integer(1),
			raw = attributeReader.take(attributeReader.integer(2));
		if (attributes.some((part) => part.id === id)) throw new Error('Duplicate IDRP path attribute.');
		attributes.push({ ...attribute(id, raw), flags });
	}
	const reachability: IdrpUpdate['reachability'] = [];
	while (reader.position < reader.bytes.length) {
		const protocolType = reader.integer(1),
			protocol = reader.take(reader.integer(1)),
			address = reader.take(reader.integer(2));
		if (!address.length) throw new Error('Empty IDRP reachability address.');
		const clnp = protocolType === 1 && protocol.length === 1 && protocol[0] === 0x81;
		if (clnp && address[0] > (address.length - 1) * 8) throw new Error('IDRP prefix exceeds address length.');
		reachability.push({
			protocolType,
			protocol,
			address: clnp ? address.slice(1) : address,
			prefixBits: clnp ? address[0] : undefined,
		});
	}
	return { withdrawnRoutes, attributes, reachability };
}

function attribute(id: number, raw: Uint8Array, hasValue = true): IdrpAttribute {
	const names = [
		'Unknown',
		'Route separator',
		'External information',
		'RD path',
		'Next hop',
		'Distribute inclusions',
		'Distribute exclusions',
		'Multi-exit discriminator',
		'Transit delay',
		'Residual error',
		'Expense',
		'Locally defined QoS',
		'Hierarchical recording',
		'RD hop count',
		'Security',
		'Capacity',
		'Priority',
	];
	const result: IdrpAttribute = { id, name: names[id] ?? 'Unknown', raw };
	if (hasValue) decodeIdrpAttribute(result);
	return result;
}
