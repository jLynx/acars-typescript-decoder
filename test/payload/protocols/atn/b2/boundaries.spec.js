import { describe, expect, it } from 'vitest';
import { decodeAtnB2Structure } from '@/index';
import { entries, wire, roots } from './wire';

const width = (min, max) => Math.ceil(Math.log2(max - min + 1));
describe('B2 CPDLC and ADS-C v2 rejection boundaries', () => {
	it.each(entries)('rejects truncated prefixes for %s', (type) => {
		const fixture = wire(type);
		for (let count = 0; count < fixture.bytes.length; count++)
			expect(() =>
				decodeAtnB2Structure(fixture.bytes.slice(0, count), { ...fixture.options, bitLength: undefined }),
			).toThrow();
	});
	it.each(
		entries.filter(
			([, node]) =>
				node.kind === 'constrained_integer' && node.maximum - node.minimum + 1 < 2 ** width(node.minimum, node.maximum),
		),
	)('rejects unused scalar %s', (type, node) => {
		const fixture = wire(type, node.maximum + 1);
		expect(() => decodeAtnB2Structure(fixture.bytes, fixture.options)).toThrow();
	});
	it.each(
		entries.filter(
			([, node]) =>
				node.kind === 'constrained_sequence_of' &&
				node.maximum - node.minimum + 1 < 2 ** width(node.minimum, node.maximum),
		),
	)('rejects unused list %s', (type, node) => {
		const fixture = wire(type, node.maximum + 1);
		expect(() => decodeAtnB2Structure(fixture.bytes, fixture.options)).toThrow();
	});
	it.each(
		entries.filter(
			([, node]) =>
				['restricted_character_string', 'NumericString', 'bit_string'].includes(node.kind) &&
				node.minimum !== null &&
				node.maximum - node.minimum + 1 < 2 ** width(node.minimum, node.maximum),
		),
	)('rejects unused string size %s', (type, node) => {
		const fixture = wire(type, { length: node.maximum + 1 });
		expect(() => decodeAtnB2Structure(fixture.bytes, fixture.options)).toThrow();
	});
	it.each(roots)('bounds input and preserves raw for %s', (root, direction, mode, application, message) => {
		const fixture = wire(root),
			options = { direction, mode, application, ...(message ? { message } : {}) };
		expect(() => decodeAtnB2Structure(new Uint8Array(8193), options)).toThrow();
		expect(() => decodeAtnB2Structure(fixture.bytes, { ...options, bitLength: 0 })).toThrow();
		expect(() =>
			decodeAtnB2Structure(fixture.bytes, { ...options, bitLength: fixture.bytes.length * 8 + 1 }),
		).toThrow();
		const result = decodeAtnB2Structure(fixture.bytes, options),
			raw = result.raw.slice();
		fixture.bytes.fill(255);
		expect(result.raw).toEqual(raw);
		const extra = Uint8Array.from([...raw, 0]);
		expect(decodeAtnB2Structure(extra, options).structureComplete).toBe(false);
	});
});
