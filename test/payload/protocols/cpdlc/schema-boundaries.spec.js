import { describe, expect, it } from 'vitest';
import { decodeFansCpdlcStructure } from '@/index';
import { descriptors, schemaWire, findSchemaValue } from './schema-wire';

const entries = Object.entries(descriptors);
const strings = entries.filter(([, node]) => ['IA5String', 'NumericString'].includes(node.kind));
const lists = entries.filter(([, node]) => node.kind === 'SEQUENCE_OF');
const choices = entries.filter(([, node]) => node.kind === 'CHOICE');
const optional = entries.filter(([, node]) => node.kind === 'SEQUENCE' && node.members.some((member) => member[2]));

function masks(count) {
	if (count <= 10)
		return Array.from({ length: 2 ** count }, (_, mask) =>
			Array.from({ length: count }, (_, index) => Boolean(mask & (2 ** index))),
		);
	const result = [Array(count).fill(false), Array(count).fill(true)];
	for (let first = 0; first < count; first++) {
		result.push(Array.from({ length: count }, (_, index) => index === first));
		result.push(Array.from({ length: count }, (_, index) => index !== first));
		for (let second = first + 1; second < count; second++)
			result.push(Array.from({ length: count }, (_, index) => index === first || index === second));
	}
	return result;
}

describe('FANS schema boundary and malformed conformance matrix', () => {
	it.each(strings)('retains minimum/maximum string length and character for %s', (type, node) => {
		for (const length of new Set([node.constraints[6], node.constraints[7]])) {
			for (const code of node.kind === 'NumericString' ? [0, 1, 10] : [0, 32, 127]) {
				const fixture = schemaWire(type, { length, code });
				const result = decodeFansCpdlcStructure(fixture.bytes, fixture.direction);
				const char = node.kind === 'NumericString' ? (code === 0 ? ' ' : String(code - 1)) : String.fromCharCode(code);
				expect(findSchemaValue(result.value, type)?.value).toBe(char.repeat(length));
				expect(result.paddingValid).toBe(true);
			}
		}
	});
	it.each(strings.filter(([, node]) => node.constraints[7] - node.constraints[6] + 1 < 2 ** node.constraints[4]))(
		'rejects every unused string length codepoint for %s',
		(type, node) => {
			for (let length = node.constraints[7] + 1; length < node.constraints[6] + 2 ** node.constraints[4]; length++) {
				const fixture = schemaWire(type, { length });
				expect(() => decodeFansCpdlcStructure(fixture.bytes, fixture.direction)).toThrow();
			}
		},
	);
	it.each([11, 12, 13, 14, 15])('rejects unused NumericString alphabet code %i', (code) => {
		const fixture = schemaWire('FANSFrequencysatchannel', { length: 12, code });
		expect(() => decodeFansCpdlcStructure(fixture.bytes, fixture.direction)).toThrow();
	});
	it.each(choices.filter(([, node]) => node.members.length < 2 ** node.constraints[0]))(
		'rejects every unused CHOICE for %s',
		(type, node) => {
			for (let choice = node.members.length; choice < 2 ** node.constraints[0]; choice++) {
				const fixture = schemaWire(type, choice);
				expect(() => decodeFansCpdlcStructure(fixture.bytes, fixture.direction)).toThrow();
			}
		},
	);
	it.each(lists.filter(([, node]) => node.constraints[7] - node.constraints[6] + 1 < 2 ** node.constraints[4]))(
		'rejects every unused list length for %s',
		(type, node) => {
			for (let count = node.constraints[7] + 1; count < node.constraints[6] + 2 ** node.constraints[4]; count++) {
				const fixture = schemaWire(type, count);
				expect(() => decodeFansCpdlcStructure(fixture.bytes, fixture.direction)).toThrow();
			}
		},
	);
	it.each(optional)('keeps optional bitmap ordering for %s', (type, node) => {
		const fields = node.members.filter((member) => member[2]);
		for (const mask of masks(fields.length)) {
			const fixture = schemaWire(type, mask);
			const result = decodeFansCpdlcStructure(fixture.bytes, fixture.direction);
			const names = findSchemaValue(result.value, type)?.children.map((child) => child.name);
			expect(names).toEqual(
				node.members.filter((member) => !member[2] || mask[fields.indexOf(member)]).map((member) => member[0]),
			);
			expect(result.paddingValid).toBe(true);
		}
	});
	it.each(Object.keys(descriptors))('rejects every shorter byte prefix reaching %s', (type) => {
		const fixture = schemaWire(type);
		const result = decodeFansCpdlcStructure(fixture.bytes, fixture.direction);
		for (let length = 0; length < Math.ceil(result.consumedBits / 8); length++)
			expect(() => decodeFansCpdlcStructure(fixture.bytes.slice(0, length), fixture.direction)).toThrow();
	});
});
