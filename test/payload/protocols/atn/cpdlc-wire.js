import schema from '@/payload/protocols/atn/cpdlc-schema.json';

// Separate X.691 conformance encoder sharing data-only descriptors, not semantic truth.
export const nodes = schema.nodes;
const width = (minimum, maximum) => Math.ceil(Math.log2(maximum - minimum + 1));
const int = (value, width) => (width ? BigInt(value).toString(2).padStart(width, '0') : '');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.max(8, Math.ceil(binary.length / 8) * 8), '0').match(/.{8}/g), (v) =>
		parseInt(v, 2),
	);
const length = (count) => (count < 128 ? int(count, 8) : int(count | 32768, 16));
const small = (count) => (count < 64 ? '0' + int(count, 6) : '1' + length(1) + int(count, 8));
const open = (binary) =>
	length(Math.max(1, Math.ceil(binary.length / 8))) + binary.padEnd(Math.max(8, Math.ceil(binary.length / 8) * 8), '0');

function contains(type, target, seen = new Set(), definitions = nodes) {
	if (type === target) return true;
	if (seen.has(type)) return false;
	seen.add(type);
	const node = definitions[type];
	return node.type
		? contains(node.type, target, seen, definitions)
		: (node.members?.some((member) => contains(member.type, target, new Set(seen), definitions)) ?? false);
}

function encode(type, target, override, maximum, definitions = nodes) {
	const node = definitions[type];
	if (node.kind === 'alias') return encode(node.type, target, override, maximum, definitions);
	if (node.members) return composite(type, node, target, override, maximum, definitions);
	const value = type === target && typeof override === 'number' ? override : maximum ? node.maximum : node.minimum;
	if (node.kind === 'null') return '';
	if (node.kind === 'boolean') return maximum ? '1' : '0';
	if (node.kind === 'enumerated')
		return type === target && override?.extension !== undefined
			? '1' + small(override.extension)
			: (node.extensible ? '0' : '') +
					int(
						type === target && override !== undefined ? override : maximum ? node.count - 1 : 0,
						width(0, node.count - 1),
					);
	if (node.kind === 'constrained_integer')
		return (node.extensible ? '0' : '') + int(value - node.minimum, width(node.minimum, node.maximum));
	if (node.kind === 'oid') return length(1) + int(42, 8);
	if (node.kind === 'relative-oid') return int(1, 8) + int(1, 8);
	const count =
		type === target && override?.length !== undefined ? override.length : maximum ? node.maximum : node.minimum;
	if (node.kind === 'bit_string' || node.kind === 'octet_string') {
		const size = count ?? 1;
		return (
			(node.extensible ? '0' : '') +
			(node.minimum === null ? length(size) : int(size - node.minimum, width(node.minimum, node.maximum))) +
			(maximum ? '1' : '0').repeat(size * (node.kind === 'octet_string' ? 8 : 1))
		);
	}
	const code =
		type === target && override?.code !== undefined
			? override.code
			: maximum
				? node.kind === 'NumericString'
					? 10
					: 127
				: 0;
	return (
		int(count - node.minimum, width(node.minimum, node.maximum)) +
		int(code, node.kind === 'NumericString' ? 4 : 7).repeat(count)
	);
}

function composite(type, node, target, override, maximum, definitions) {
	const members = node.members.filter((member) => !member.extension);
	const extensions = node.members.filter((member) => member.extension);
	if (node.kind === 'choice') {
		const extension =
			type === target && override?.extension !== undefined
				? override.extension
				: members.some((member) => contains(member.type, target, new Set(), definitions))
					? -1
					: extensions.findIndex((member) => contains(member.type, target, new Set(), definitions));
		if (extension >= 0)
			return '1' + small(extension) + open(encode(extensions[extension].type, target, override, maximum, definitions));
		let choice =
			type === target && override !== undefined
				? override
				: members.findIndex((member) => contains(member.type, target, new Set(), definitions));
		if (choice < 0) choice = maximum ? members.length - 1 : 0;
		return (
			(node.extensible ? '0' : '') +
			int(choice, width(0, members.length - 1)) +
			(members[choice] ? encode(members[choice].type, target, override, maximum, definitions) : '')
		);
	}
	if (node.kind === 'constrained_sequence_of') {
		const count = type === target && override !== undefined ? override : maximum ? node.maximum : node.minimum;
		return (
			int(count - node.minimum, width(node.minimum, node.maximum)) +
			encode(members[0].type, target, override, maximum, definitions).repeat(count)
		);
	}
	let optional = 0;
	const include = members.map(
		(member) =>
			!member.optional ||
			(type === target && Array.isArray(override)
				? override[optional++]
				: maximum || contains(member.type, target, new Set(), definitions)),
	);
	const extended = extensions.map((member) => contains(member.type, target, new Set(), definitions));
	const last = extended.lastIndexOf(true);
	const suffix =
		last < 0
			? ''
			: small(last) +
				extended
					.slice(0, last + 1)
					.map((v) => (v ? '1' : '0'))
					.join('') +
				extensions
					.slice(0, last + 1)
					.map((member, i) => (extended[i] ? open(encode(member.type, target, override, maximum, definitions)) : ''))
					.join('');
	return (
		(node.extensible ? (last >= 0 ? '1' : '0') : '') +
		members
			.filter((member) => member.optional)
			.map((member) => (include[members.indexOf(member)] ? '1' : '0'))
			.join('') +
		members
			.map((member, i) => (include[i] ? encode(member.type, target, override, maximum, definitions) : ''))
			.join('') +
		suffix
	);
}

export function wire(target, override, maximum = false) {
	const roots = [
		['GroundPDUs', 'uplink', 'plain'],
		['AircraftPDUs', 'downlink', 'plain'],
		['ProtectedGroundPDUs', 'uplink', 'protected'],
		['ProtectedAircraftPDUs', 'downlink', 'protected'],
	];
	return schemaWire(nodes, roots, target, override, maximum);
}

export function schemaWire(definitions, roots, target, override, maximum = false) {
	const [root, direction, mode, application, message] = roots.find(([root]) =>
		contains(root, target, new Set(), definitions),
	);
	const binary = encode(root, target, override, maximum, definitions);
	return {
		bytes: bytes(binary),
		options: {
			direction,
			mode,
			...(application ? { application } : {}),
			...(message ? { message } : {}),
			bitLength: binary.length || 1,
		},
	};
}

export const find = (value, type) =>
	value.type === type
		? value
		: [...(value.children ?? []), ...(value.extensions?.map((extension) => extension.value).filter(Boolean) ?? [])]
				.map((child) => find(child, type))
				.find(Boolean);
