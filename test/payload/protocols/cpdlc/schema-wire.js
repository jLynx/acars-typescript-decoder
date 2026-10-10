import schema from '@/payload/protocols/cpdlc/schema.json';

// Independent schema-driven X.691 encoder for conformance cases. This does not
// supply semantic expected units; hand-packed schema.spec.js fixtures do that.
export const descriptors = schema.nodes;
const integer = (width, value) => (width === 0 ? '' : BigInt(value).toString(2).padStart(width, '0'));
const octets = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (octet) => parseInt(octet, 2));

function contains(type, target, visited = new Set()) {
	if (type === target) return true;
	if (visited.has(type)) return false;
	visited.add(type);
	const node = descriptors[type];
	if (!node) return false;
	return node.members
		? node.members.some((member) => contains(member[1], target, new Set(visited)))
		: contains(node.kind, target, visited);
}

function encode(type, target, override, maximum, inherited) {
	const node = descriptors[type] ?? { kind: type, constraints: inherited };
	const constraints = node.constraints ?? inherited;
	if (node.members) return composite(type, node, target, override, maximum);
	if (descriptors[node.kind]) return encode(node.kind, target, override, maximum, constraints);
	const value = type === target && override !== undefined ? override : maximum ? constraints?.[3] : constraints?.[2];
	if (node.kind === 'NULL') return '';
	if (node.kind === 'BOOLEAN') return maximum ? '1' : '0';
	if (node.kind === 'NativeInteger' || node.kind === 'NativeEnumerated')
		return integer(constraints[0], value - constraints[2]);
	const count =
		type === target && override?.length !== undefined ? override.length : maximum ? constraints[7] : constraints[6];
	const code =
		type === target && override?.code !== undefined
			? override.code
			: maximum
				? node.kind === 'NumericString'
					? 10
					: 127
				: 0;
	return (
		integer(constraints[4], count - constraints[6]) + integer(node.kind === 'NumericString' ? 4 : 7, code).repeat(count)
	);
}

function composite(type, node, target, override, maximum) {
	const members = node.members;
	if (node.kind === 'CHOICE') {
		let index =
			type === target && override !== undefined ? override : members.findIndex((member) => contains(member[1], target));
		if (index < 0) index = maximum ? members.length - 1 : 0;
		return (
			integer(node.constraints[0], index) + (members[index] ? encode(members[index][1], target, override, maximum) : '')
		);
	}
	if (node.kind === 'SEQUENCE_OF') {
		const count =
			type === target && override !== undefined ? override : maximum ? node.constraints[7] : node.constraints[6];
		return (
			integer(node.constraints[4], count - node.constraints[6]) +
			encode(members[0][1], target, override, maximum).repeat(count)
		);
	}
	let optional = 0;
	const include = members.map(
		(member) =>
			!member[2] ||
			(type === target && Array.isArray(override) ? override[optional++] : maximum || contains(member[1], target)),
	);
	return (
		members
			.filter((member) => member[2])
			.map((member) => (include[members.indexOf(member)] ? '1' : '0'))
			.join('') +
		members.map((member, index) => (include[index] ? encode(member[1], target, override, maximum) : '')).join('')
	);
}

export function schemaWire(target, override, maximum = false) {
	const type = contains('FANSATCUplinkMessage', target) ? 'FANSATCUplinkMessage' : 'FANSATCDownlinkMessage';
	return {
		bytes: octets(encode(type, target, override, maximum)),
		direction: type === 'FANSATCUplinkMessage' ? 'uplink' : 'downlink',
	};
}

export function findSchemaValue(node, type) {
	return node.type === type ? node : node.children?.map((child) => findSchemaValue(child, type)).find(Boolean);
}
