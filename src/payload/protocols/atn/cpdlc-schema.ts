// Data-only pinned Wireshark ASN.1 layouts; locally authored bounded UPER reader.
import schema from './cpdlc-schema.json';
import { Bits } from '@/payload/protocols/bits';
import { normallySmall, signedInteger } from './acse-values';
import { perPayload, perOid } from './per';
import type { AtnCpdlcDescriptor, AtnCpdlcValue, AtnCpdlcState } from './cpdlc.types';

const descriptors = schema.nodes as unknown as Record<string, AtnCpdlcDescriptor>;
const width = (minimum: number, maximum: number) => Math.ceil(Math.log2(maximum - minimum + 1));

function scalar(bits: Bits, descriptor: AtnCpdlcDescriptor): AtnCpdlcValue['value'] {
	const minimum = descriptor.minimum ?? 0,
		maximum = descriptor.maximum ?? 0;
	if (descriptor.kind === 'null') return null;
	if (descriptor.kind === 'boolean') return Boolean(bits.read(1));
	if (descriptor.kind === 'enumerated') {
		const count = descriptor.count!;
		return descriptor.extensible && bits.read(1)
			? normallySmall(bits) + count
			: bits.constrained(width(0, count - 1), 0, count - 1);
	}
	if (descriptor.kind === 'constrained_integer')
		return descriptor.minimum === null || (descriptor.extensible && bits.read(1))
			? signedInteger(bits)
			: bits.constrained(width(minimum, maximum), minimum, maximum);
	if (descriptor.kind === 'relative-oid') return relativeOid(bits);
	if (descriptor.kind === 'oid') return perOid(bits);
	if (descriptor.kind === 'bit_string' || descriptor.kind === 'octet_string') return binaryString(bits, descriptor);
	const count = bits.constrained(width(minimum, maximum), minimum, maximum);
	if (descriptor.kind === 'restricted_character_string')
		return Array.from({ length: count }, () => String.fromCharCode(bits.read(7))).join('');
	if (descriptor.kind !== 'NumericString') throw new Error('Unsupported ATN schema primitive');
	return Array.from({ length: count }, () => {
		const code = bits.constrained(4, 0, 10);
		return code ? String(code - 1) : ' ';
	}).join('');
}

function binaryString(bits: Bits, descriptor: AtnCpdlcDescriptor): AtnCpdlcValue['value'] {
	const unit = descriptor.kind === 'bit_string' ? 1 : 8;
	if (descriptor.minimum === null || (descriptor.extensible && bits.read(1))) return perPayload(bits, unit);
	const minimum = descriptor.minimum!,
		maximum = descriptor.maximum!;
	const count = bits.constrained(width(minimum, maximum), minimum, maximum);
	const bitLength = count * unit;
	if (bitLength > 65536) throw new Error('Oversized ATN string');
	const payload = new Uint8Array(Math.ceil(bitLength / 8));
	for (let index = 0; index < bitLength; index++) payload[index >> 3] |= bits.read(1) << (7 - (index % 8));
	return { payload, bitLength };
}

function relativeOid(bits: Bits): string {
	const { payload } = perPayload(bits, 8);
	if (!payload.length || payload.length > 64) throw new Error('Invalid algorithm relative OID');
	const arcs: number[] = [];
	let current = 0,
		first = true;
	for (const octet of payload) {
		if (first && octet === 128) throw new Error('Nonminimal algorithm relative OID');
		current = current * 128 + (octet & 127);
		if (!Number.isSafeInteger(current)) throw new Error('Oversized algorithm relative OID');
		first = false;
		if (!(octet & 128)) {
			arcs.push(current);
			current = 0;
			first = true;
		}
	}
	if (!first) throw new Error('Truncated algorithm relative OID');
	return arcs.join('.');
}

function choice(
	bits: Bits,
	descriptor: AtnCpdlcDescriptor,
	state: AtnCpdlcState,
	depth: number,
): Partial<AtnCpdlcValue> {
	const root = descriptor.members!.filter((member) => !member.extension);
	if (descriptor.extensible && bits.read(1)) {
		const index = normallySmall(bits);
		const { payload } = perPayload(bits, 8);
		const member = descriptor.members!.filter((member) => member.extension)[index];
		return {
			choice: member?.name ?? 'extension',
			choiceIndex: root.length + index,
			extensions: [{ index, payload, ...(member ? { value: openType(member.type, payload, state, depth) } : {}) }],
		};
	}
	const index = bits.constrained(width(0, root.length - 1), 0, root.length - 1);
	const member = root[index];
	return {
		choice: member.name,
		choiceIndex: index,
		children: [{ ...read(member.type, bits, state, depth + 1), name: member.name }],
	};
}

function openType(type: string, payload: Uint8Array, state: AtnCpdlcState, depth: number): AtnCpdlcValue {
	if (!payload.length) throw new Error('Empty ATN known extension open type');
	const bits = new Bits(payload);
	const value = read(type, bits, state, depth + 1);
	const emptyEncoding = bits.position === 0 && payload.length === 1 && payload[0] === 0;
	if (!emptyEncoding && !bits.paddingOnly()) throw new Error('Invalid ATN known extension padding');
	return value;
}

function sequence(
	bits: Bits,
	descriptor: AtnCpdlcDescriptor,
	state: AtnCpdlcState,
	depth: number,
): Partial<AtnCpdlcValue> {
	const extended = descriptor.extensible && bits.read(1);
	const root = descriptor.members!.filter((member) => !member.extension);
	const flags = root.filter((member) => member.optional).map(() => bits.read(1));
	let index = 0;
	const children = root.flatMap((member) => {
		if (!member.optional || flags[index++])
			return [{ ...read(member.type, bits, state, depth + 1), name: member.name }];
		if (member.defaultValue === undefined) return [];
		return [
			{
				type: member.type,
				name: member.name,
				startBit: bits.position,
				bitLength: 0,
				value: member.defaultValue,
				defaulted: true,
				enumeration: state.descriptors[member.type].enumeration?.[String(member.defaultValue)],
			},
		];
	});
	const extensions: NonNullable<AtnCpdlcValue['extensions']> = [];
	if (extended) {
		const count = normallySmall(bits) + 1;
		if (count > 64) throw new Error('Too many ATN schema extensions');
		const present = Array.from({ length: count }, () => bits.read(1));
		for (let index = 0; index < count; index++) {
			if (present[index]) {
				const payload = perPayload(bits, 8).payload;
				const member = descriptor.members!.filter((member) => member.extension)[index];
				extensions.push({
					index,
					payload,
					...(member ? { value: { ...openType(member.type, payload, state, depth), name: member.name } } : {}),
				});
			}
		}
	}
	return { children, ...(extended ? { extensions } : {}) };
}

function read(type: string, bits: Bits, state: AtnCpdlcState, depth: number): AtnCpdlcValue {
	if (depth > 48 || ++state.nodes > 4096) throw new Error('ATN schema resource limit exceeded');
	const descriptor = state.descriptors[type];
	if (!descriptor) throw new Error('Unknown ATN schema type');
	const startBit = bits.position;
	let value: Partial<AtnCpdlcValue>;
	if (descriptor.kind === 'alias') value = { children: [read(descriptor.type!, bits, state, depth + 1)] };
	else if (descriptor.kind === 'choice') value = choice(bits, descriptor, state, depth);
	else if (descriptor.kind === 'sequence') value = sequence(bits, descriptor, state, depth);
	else if (descriptor.kind === 'constrained_sequence_of') {
		const count = bits.constrained(
			width(descriptor.minimum!, descriptor.maximum!),
			descriptor.minimum!,
			descriptor.maximum!,
		);
		if (count > 128) throw new Error('Too many ATN list elements');
		value = {
			children: Array.from({ length: count }, () => read(descriptor.members![0].type, bits, state, depth + 1)),
		};
	} else {
		const raw = scalar(bits, descriptor);
		value = {
			value: raw,
			...(descriptor.enumeration && typeof raw === 'number'
				? { enumeration: descriptor.enumeration[String(raw)] }
				: {}),
		};
	}
	return { type, startBit, bitLength: bits.position - startBit, ...value };
}

export function readAtnCpdlcRoot(
	bytes: Uint8Array,
	type: string,
	definitions = descriptors,
): { value: AtnCpdlcValue; bits: Bits } {
	const bits = new Bits(bytes);
	return { value: read(type, bits, { nodes: 0, descriptors: definitions }, 0), bits };
}
