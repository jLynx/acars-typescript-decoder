import { describe, expect, it } from 'vitest';
import { decodeFansCpdlcStructure } from '@/index';
import { descriptors, schemaWire, findSchemaValue } from './schema-wire';

describe('pinned FANS schema conformance matrix', () => {
	it.each(Object.keys(descriptors))('reads reachable descriptor %s with minimal fields', (type) => {
		const fixture = schemaWire(type);
		const result = decodeFansCpdlcStructure(fixture.bytes, fixture.direction);
		expect(result.paddingValid).toBe(true);
		expect(findSchemaValue(result.value, type)?.type).toBe(type);
	});
	it.each(
		Object.entries(descriptors)
			.filter(([, node]) => node.kind === 'CHOICE')
			.flatMap(([type, node]) => node.members.map((member, index) => [type, index, member[0]])),
	)('reads choice %s/%i/%s', (type, choice, name) => {
		const fixture = schemaWire(type, choice);
		const result = decodeFansCpdlcStructure(fixture.bytes, fixture.direction);
		expect(result.paddingValid).toBe(true);
		expect(findSchemaValue(result.value, type)?.choice).toBe(name);
	});
	it.each(
		Object.entries(descriptors)
			.filter(([, node]) => ['NativeInteger', 'NativeEnumerated'].includes(node.kind))
			.map(([type, node]) => [type, node.constraints[2], node.constraints[3]]),
	)('validates scalar %s at %i..%i', (type, minimum, maximum) => {
		for (const value of [minimum, maximum]) {
			const fixture = schemaWire(type, value);
			const result = decodeFansCpdlcStructure(fixture.bytes, fixture.direction);
			expect(findSchemaValue(result.value, type)?.value).toBe(value);
			expect(result.paddingValid).toBe(true);
		}
	});
	it.each(
		Object.entries(descriptors)
			.filter(
				([, node]) =>
					['NativeInteger', 'NativeEnumerated'].includes(node.kind) &&
					node.constraints[3] - node.constraints[2] + 1 < 2 ** node.constraints[0],
			)
			.map(([type, node]) => [type, node.constraints[3] + 1]),
	)('rejects unused scalar %s value %i', (type, invalid) => {
		const fixture = schemaWire(type, invalid);
		expect(() => decodeFansCpdlcStructure(fixture.bytes, fixture.direction)).toThrow();
	});
	it.each(
		Object.entries(descriptors)
			.filter(([, node]) => node.kind === 'SEQUENCE_OF')
			.map(([type, node]) => [type, node.constraints[7]]),
	)('reads maximum list length for %s: %i', (type, maximum) => {
		const fixture = schemaWire(type, maximum);
		const result = decodeFansCpdlcStructure(fixture.bytes, fixture.direction);
		expect(findSchemaValue(result.value, type)?.children).toHaveLength(maximum);
		expect(result.paddingValid).toBe(true);
	});
});
