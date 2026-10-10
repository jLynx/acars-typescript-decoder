import { describe, expect, it } from 'vitest';
import { createDecoder, decode, decodeLog } from '@/index';
import { airportName } from '@/airports';

const input = { label: '3L', text: 'S 37.306/E174.100 /UTC 0809', receivedAt: Date.UTC(2026, 9, 10, 8, 10) };
const record = (id, extra = {}) => ({
	...input,
	id,
	registration: 'ZK-NZE',
	mode: '2',
	acknowledgement: 'NAK',
	blockId: '0',
	direction: 'downlink',
	continuation: false,
	...extra,
});
const interpretation = (title = 'Custom') => ({
	title,
	summary: 'Decoded by plugin',
	coverage: 'decoded',
	fields: [],
	notes: [],
});

describe('public decoder API', () => {
	it('decodes payloads with minimal metadata', () => {
		expect(decode(input)).toMatchObject({ title: 'Position report', coverage: 'decoded' });
		expect(decode({ label: 'Q0', text: '' })).toMatchObject({ title: 'Link test', coverage: 'decoded' });
	});
	it('uses optional airport data without modifying input', () => {
		const message = Object.freeze({ label: '5D', text: 'NZAA' });
		expect(decode(message).fields[0].value).toBe('NZAA');
		expect(createDecoder({ airportLookup: airportName }).decode(message).fields[0].value).toBe(
			'NZAA · Auckland International Airport',
		);
		expect(message.text).toBe('NZAA');
	});
	it.each([
		{ label: 'X' },
		{ text: null },
		{ text: 'x'.repeat(8193) },
		{ direction: 'unknown' },
		{ receivedAt: NaN },
		{ receivedAt: Infinity },
		{ id: -1 },
		{ id: 1.2 },
		{ continuation: 'yes' },
		{ messageNumber: null },
		{ registration: 'x'.repeat(241) },
	])('rejects malformed input %j', (invalid) => expect(() => decode({ ...input, ...invalid })).toThrow());
	it('retains every record beyond viewer-sized batches, sorted by receipt time', () => {
		const records = Array.from({ length: 250 }, (_, i) => record(i + 1, { receivedAt: i + 1 }));
		expect(decodeLog(records.reverse()).map((m) => m.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
	});
	it('rejects duplicate IDs and oversized batches', () => {
		expect(() => decodeLog([record(1), record(1)])).toThrow(/unique/);
		expect(() => decodeLog(Array(10001).fill(record(1)))).toThrow(/10000/);
	});
	it('keeps calls independent and preserves raw text on assembled records', () => {
		const a = record(1, { label: 'ZZ', text: 'ONE ', messageNumber: 'M01A', continuation: true });
		const b = record(2, { label: 'ZZ', text: 'TWO', messageNumber: 'M01B', receivedAt: a.receivedAt + 10 });
		expect(decodeLog([a, b])[1]).toMatchObject({ text: 'TWO', assembledText: 'ONE TWO' });
		expect(decodeLog([b])[0].assembledText).toBeUndefined();
		expect(a.text).toBe('ONE ');
	});
});

describe('plugin isolation', () => {
	it('uses caller precedence and snapshots plugin configuration', () => {
		const plugins = [
			{ name: 'first', decode: () => interpretation('First') },
			{ name: 'second', decode: () => interpretation('Second') },
		];
		const decoder = createDecoder({ plugins });
		plugins.reverse();
		expect(decoder.decode(input).title).toBe('First');
	});
	it.each([
		() => {
			throw new Error('broken');
		},
		() => ({ title: 'bad' }),
		() => ({ ...interpretation(), coverage: 'invented' }),
		() => ({ ...interpretation(), fields: [null] }),
		() => ({ ...interpretation(), notes: [1] }),
		(message) => {
			message.text = 'mutated';
			return interpretation();
		},
	])('falls back when plugins fail or return malformed output', (plugin) => {
		expect(createDecoder({ plugins: [{ name: 'bad', decode: plugin }] }).decode({ label: 'Q0', text: '' }).title).toBe(
			'Link test',
		);
	});
	it('returns independent copies of plugin results', () => {
		const result = interpretation();
		const decoder = createDecoder({ plugins: [{ name: 'copy', decode: () => result }] });
		decoder.decode(input).notes.push('mutated');
		expect(result.notes).toEqual([]);
		expect(decoder.decode(input).notes).toEqual([]);
	});
	it('passes reassembled text to plugins and preserves assembly evidence', () => {
		const seen = [];
		const decoder = createDecoder({
			plugins: [
				{
					name: 'assembly',
					decode: (m) => {
						seen.push(m.text);
						return interpretation();
					},
				},
			],
		});
		const result = decoder.decodeLog([
			record(1, { label: 'ZZ', text: 'ONE ', messageNumber: 'M01A', continuation: true }),
			record(2, { label: 'ZZ', text: 'TWO', messageNumber: 'M01B', receivedAt: input.receivedAt + 10 }),
		]);
		expect(seen).toEqual(['ONE ', 'ONE TWO']);
		expect(result[1].interpretation.notes.join(' ')).toContain('Reassembled 2 consecutive blocks');
	});
});
