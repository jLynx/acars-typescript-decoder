import { describe, expect, it } from 'vitest';
import { decodeAtnB2Structure } from '@/index';
import { entries, wire, find } from './wire';

describe('pinned B2 CPDLC and ADS-C v2 descriptor conformance', () => {
	it.each(entries)('reads reachable type %s', (type) => {
		const fixture = wire(type),
			result = decodeAtnB2Structure(fixture.bytes, fixture.options);
		expect(find(result.value, type)).toBeDefined();
		expect(result.structureComplete).toBe(true);
	});
	it.each(
		entries
			.filter(([, node]) => node.kind === 'choice')
			.flatMap(([type, node]) =>
				node.members.map((member, i) => [
					type,
					member.extension ? { extension: node.members.filter((m) => m.extension).indexOf(member) } : i,
					member.name,
				]),
			),
	)('reads %s choice %j %s', (type, index, name) => {
		const fixture = wire(type, index),
			result = decodeAtnB2Structure(fixture.bytes, fixture.options);
		expect(find(result.value, type)?.choice).toBe(name);
		expect(result.structureComplete).toBe(true);
	});
	it.each(entries.filter(([, node]) => node.kind === 'constrained_integer'))(
		'reads %s scalar extrema',
		(type, node) => {
			for (const value of [node.minimum, node.maximum]) {
				const fixture = wire(type, value),
					result = decodeAtnB2Structure(fixture.bytes, fixture.options);
				expect(find(result.value, type)?.value).toBe(value);
				expect(result.structureComplete).toBe(true);
			}
		},
	);
	it.each(entries.filter(([, node]) => node.kind === 'enumerated'))('reads %s named enumerations', (type, node) => {
		for (const [code, name] of Object.entries(node.enumeration)) {
			const value = Number(code);
			const fixture = wire(type, value >= node.count ? { extension: value - node.count } : value);
			const result = decodeAtnB2Structure(fixture.bytes, fixture.options);
			expect(find(result.value, type)).toMatchObject({ value, enumeration: name });
			expect(result.structureComplete).toBe(true);
		}
	});
	it.each(
		entries.filter(([, node]) =>
			['bit_string', 'octet_string', 'restricted_character_string', 'NumericString'].includes(node.kind),
		),
	)('reads %s string limits', (type, node) => {
		for (const length of node.minimum === null ? [0, 1, 128] : [node.minimum, node.maximum]) {
			const fixture = wire(type, { length }),
				result = decodeAtnB2Structure(fixture.bytes, fixture.options);
			const value = find(result.value, type).value;
			expect(typeof value === 'string' ? value.length : value.bitLength).toBe(
				length * (node.kind === 'octet_string' ? 8 : 1),
			);
			expect(result.structureComplete).toBe(true);
		}
	});
	it.each(entries.filter(([, node]) => node.kind === 'constrained_sequence_of'))(
		'reads %s list limits',
		(type, node) => {
			for (const count of [node.minimum, node.maximum]) {
				const fixture = wire(type, count),
					result = decodeAtnB2Structure(fixture.bytes, fixture.options);
				expect(find(result.value, type)?.children).toHaveLength(count);
				expect(result.structureComplete).toBe(true);
			}
		},
	);
	it.each(
		entries
			.filter(([, node]) => node.kind === 'sequence' && node.members.some((m) => m.optional && !m.extension))
			.flatMap(([type, node]) => {
				const root = node.members.filter((m) => !m.extension),
					optional = root.filter((m) => m.optional),
					count = optional.length;
				const masks =
					count <= 9
						? Array.from({ length: 2 ** count }, (_, mask) =>
								Array.from({ length: count }, (_, i) => Boolean(mask & (2 ** i))),
							)
						: [
								Array(count).fill(false),
								Array(count).fill(true),
								...Array.from({ length: count }, (_, at) => Array.from({ length: count }, (_, i) => i === at)),
							];
				// Keep every bitmap assertion, with its own timeout and diagnostic name under coverage.
				return masks.map((mask) => [type, mask.map(Number).join(''), mask, root, optional]);
			}),
	)('reads %s optional bitmap %s', (type, _bitmap, mask, root, optional) => {
		const fixture = wire(type, mask),
			result = decodeAtnB2Structure(fixture.bytes, fixture.options);
		expect(find(result.value, type)?.children.map((v) => v.name)).toEqual(
			root.filter((m) => !m.optional || m.defaultValue !== undefined || mask[optional.indexOf(m)]).map((m) => m.name),
		);
		expect(result.structureComplete).toBe(true);
	});
});
