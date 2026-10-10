// Data-only PER descriptors adapted from MIT libacars at the pinned schema revision.
import schema from './schema.json';
import { Bits } from '@/payload/protocols/bits';
import type { FansSchemaDescriptor, FansSchemaValue, FansCpdlcStructure, FansSchemaState } from './schema.types';

const descriptors = schema.nodes as unknown as Record<string, FansSchemaDescriptor>;

function scalar(type: string, bits: Bits, descriptor: FansSchemaDescriptor): FansSchemaValue['value'] {
	const constraints = descriptor.constraints;
	if (type === 'NULL') return null;
	if (type === 'BOOLEAN') return Boolean(bits.read(1));
	if (!constraints) throw new Error('Missing FANS scalar constraints');
	if (type === 'NativeInteger' || type === 'NativeEnumerated')
		return bits.constrained(constraints[0], constraints[2], constraints[3]);
	const count = bits.constrained(constraints[4], constraints[6], constraints[7]);
	if (type === 'IA5String') return Array.from({ length: count }, () => String.fromCharCode(bits.read(7))).join('');
	if (type !== 'NumericString') throw new Error(`Unsupported FANS primitive ${type}`);
	let value = '';
	for (let index = 0; index < count; index++) {
		const code = bits.constrained(4, 0, 10);
		value += code === 0 ? ' ' : String(code - 1);
	}
	return value;
}

function children(
	descriptor: FansSchemaDescriptor,
	bits: Bits,
	state: FansSchemaState,
	depth: number,
): FansSchemaValue[] {
	const members = descriptor.members!;
	if (descriptor.kind === 'CHOICE') {
		const constraints = descriptor.constraints!;
		const selected = bits.constrained(constraints[0], constraints[2], constraints[3]);
		const member = members[selected];
		if (!member) throw new Error('Invalid FANS CHOICE');
		return [{ ...read(member[1], bits, state, depth + 1), name: member[0] }];
	}
	if (descriptor.kind === 'SEQUENCE_OF') {
		const constraints = descriptor.constraints!;
		const count = bits.constrained(constraints[4], constraints[6], constraints[7]);
		if (count > 128) throw new Error('Too many FANS list elements');
		return Array.from({ length: count }, () => read(members[0][1], bits, state, depth + 1));
	}
	const present = members.filter((member) => member[2]).map(() => bits.read(1));
	let optional = 0;
	return members.flatMap(([name, type, isOptional]) => {
		if (isOptional && !present[optional++]) return [];
		return [{ ...read(type, bits, state, depth + 1), name }];
	});
}

function read(
	type: string,
	bits: Bits,
	state: FansSchemaState,
	depth: number,
	constraints?: number[] | null,
): FansSchemaValue {
	if (depth > 48 || ++state.nodes > 4096) throw new Error('FANS schema resource limit exceeded');
	const startBit = bits.position;
	const descriptor = descriptors[type];
	if (!descriptor) {
		const value = scalar(type, bits, { kind: type, constraints: constraints ?? null });
		return { type, startBit, bitLength: bits.position - startBit, value };
	}
	if (!descriptor.members) {
		const inherited = read(descriptor.kind, bits, state, depth + 1, descriptor.constraints ?? constraints);
		return {
			...inherited,
			type,
			...(descriptors[descriptor.kind] ? { children: [inherited] } : {}),
			...(descriptor.enumeration ? { enumeration: descriptor.enumeration[String(inherited.value)] } : {}),
		};
	}
	const values = children(descriptor, bits, state, depth);
	return {
		type,
		startBit,
		bitLength: bits.position - startBit,
		children: values,
		...(descriptor.kind === 'CHOICE' ? { choice: values[0].name } : {}),
	};
}

/** Read every FANS schema type without interpreting ambiguous ATN data as FANS. */
export function decodeFansCpdlcStructure(bytes: Uint8Array, direction: 'uplink' | 'downlink'): FansCpdlcStructure {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 8192)
		throw new RangeError('FANS CPDLC requires 1–8192 bytes');
	if (direction !== 'uplink' && direction !== 'downlink') throw new TypeError('FANS CPDLC direction required');
	const bits = new Bits(bytes);
	const value = read(direction === 'uplink' ? 'FANSATCUplinkMessage' : 'FANSATCDownlinkMessage', bits, { nodes: 0 }, 0);
	return {
		protocol: 'FANS-CPDLC',
		direction,
		raw: bytes.slice(),
		value,
		consumedBits: bits.position,
		paddingValid: bits.paddingOnly(),
		integrity: 'unverified',
		source: {
			repository: 'https://github.com/szpajder/libacars',
			revision: schema.revision,
			files: ['libacars/asn1/FANS*.c'],
		},
	};
}
