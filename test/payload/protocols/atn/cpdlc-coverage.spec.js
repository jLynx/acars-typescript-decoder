import { describe, expect, it } from 'vitest';
import { decodeAtnCpdlc } from '@/index';
import { nodes, wire, find } from './cpdlc-wire';

const entries = Object.entries(nodes);
describe('pinned ATN CPDLC schema conformance', () => {
	it.each(Object.keys(nodes))('reads reachable type %s', (type) => {
		const fixture = wire(type),
			result = decodeAtnCpdlc(fixture.bytes, fixture.options);
		expect(find(result.value, type)).toBeDefined();
		expect(result.structureComplete).toBe(true);
	});
	it.each(
		entries
			.filter(([, node]) => node.kind === 'choice')
			.flatMap(([type, node]) =>
				node.members.filter((member) => !member.extension).map((member, i) => [type, i, member.name]),
			),
	)('reads %s choice %i %s', (type, index, name) => {
		const fixture = wire(type, index),
			result = decodeAtnCpdlc(fixture.bytes, fixture.options);
		expect(find(result.value, type)?.choice).toBe(name);
		expect(result.structureComplete).toBe(true);
	});
	it.each(entries.filter(([, node]) => node.kind === 'constrained_integer'))(
		'reads scalar %s boundaries',
		(type, node) => {
			for (const value of [node.minimum, node.maximum]) {
				const fixture = wire(type, value),
					result = decodeAtnCpdlc(fixture.bytes, fixture.options);
				expect(find(result.value, type)?.value).toBe(value);
				expect(result.structureComplete).toBe(true);
			}
		},
	);
	it.each(entries.filter(([, node]) => node.kind === 'enumerated'))('reads every root enum for %s', (type, node) => {
		for (let index = 0; index < node.count; index++) {
			const fixture = wire(type, index),
				result = decodeAtnCpdlc(fixture.bytes, fixture.options);
			expect(find(result.value, type)?.value).toBe(index);
		}
	});
	it.each(entries.filter(([, node]) => ['restricted_character_string', 'NumericString'].includes(node.kind)))(
		'checks string %s limits and characters',
		(type, node) => {
			for (const length of [node.minimum, node.maximum]) {
				for (const code of node.kind === 'NumericString' ? [0, 1, 10] : [0, 32, 127]) {
					const fixture = wire(type, { length, code }),
						result = decodeAtnCpdlc(fixture.bytes, fixture.options);
					const char = node.kind === 'NumericString' ? (code ? String(code - 1) : ' ') : String.fromCharCode(code);
					expect(find(result.value, type)?.value).toBe(char.repeat(length));
					expect(result.structureComplete).toBe(true);
				}
			}
		},
	);
	it.each(entries.filter(([, node]) => node.kind === 'constrained_sequence_of'))(
		'checks maximum list size for %s',
		(type, node) => {
			const fixture = wire(type, node.maximum),
				result = decodeAtnCpdlc(fixture.bytes, fixture.options);
			expect(find(result.value, type)?.children).toHaveLength(node.maximum);
			expect(result.structureComplete).toBe(true);
		},
	);
	it.each(
		entries
			.filter(([, node]) => node.kind === 'sequence' && node.members.some((member) => member.optional))
			.flatMap(([type, node]) => {
				const optional = node.members.filter((member) => member.optional);
				const count = optional.length;
				const masks =
					count <= 10
						? Array.from({ length: 2 ** count }, (_, mask) =>
								Array.from({ length: count }, (_, i) => Boolean(mask & (2 ** i))),
							)
						: [
								Array(count).fill(false),
								Array(count).fill(true),
								...Array.from({ length: count }, (_, at) => Array.from({ length: count }, (_, i) => i === at)),
							];
				// Give each bitmap its own timeout and failure label, including all 1024 RouteClearance cases.
				return masks.map((mask) => [type, mask.map(Number).join(''), mask, node, optional]);
			}),
	)('checks optional bitmap for %s: %s', (type, _bitmap, mask, node, optional) => {
		const fixture = wire(type, mask),
			result = decodeAtnCpdlc(fixture.bytes, fixture.options);
		expect(find(result.value, type)?.children.map((member) => member.name)).toEqual(
			node.members.filter((member) => !member.optional || mask[optional.indexOf(member)]).map((member) => member.name),
		);
		expect(result.structureComplete).toBe(true);
	});
	it.each(Object.keys(nodes))('rejects shorter byte prefixes for %s', (type) => {
		const fixture = wire(type);
		for (let count = 0; count < fixture.bytes.length; count++)
			expect(() =>
				decodeAtnCpdlc(fixture.bytes.slice(0, count), { ...fixture.options, bitLength: undefined }),
			).toThrow();
	});
});
