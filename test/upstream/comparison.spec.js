import { describe, expect, it } from 'vitest';
import { compareFields } from '../../scripts/upstream/fields.mjs';

const actual = (fields, extra = {}) => ({ fields, notes: [], ...extra });
const input = { text: '' };
describe('upstream comparison evidence', () => {
	it('recognizes nested renamed fields and JSON structural equivalence', () => {
		const result = compareFields(
			[
				{ label: 'Tail', value: 'TEST' },
				{ label: 'OHMA Downlink', value: '{"a":1,"b":[2]}' },
			],
			actual([{ label: 'Application JSON', value: '{ "b": [2], "a": 1 }' }], {
				embedded: actual([{ label: 'Reported registration', value: 'TEST' }]),
			}),
			input,
		);
		expect(result.map((item) => item.classification)).toEqual(['renamed', 'json-equivalent']);
	});
	it('does not treat changed numeric values, units or unrelated equal values as equivalent', () => {
		const result = compareFields(
			[
				{ label: 'Altitude', value: '100 ft' },
				{ label: 'Heading', value: '90' },
			],
			actual([
				{ label: 'Altitude', value: '100 m' },
				{ label: 'Other', value: '90' },
			]),
			input,
		);
		expect(result.every((item) => item.classification === 'unresolved')).toBe(true);
	});
	it('requires exact wire evidence before classifying flight leading zeroes', () => {
		const result = compareFields(
			[{ label: 'Flight Number', value: 'UA7' }],
			actual([{ label: 'Flight Number', value: 'UA0007' }]),
			{ text: 'M05AUA0007rest' },
		);
		expect(result[0].classification).toBe('preserved-wire-flight-code');
		expect(
			compareFields(
				[{ label: 'Flight Number', value: 'UA7' }],
				actual([{ label: 'Flight Number', value: 'UA0007' }]),
				input,
			)[0].classification,
		).toBe('unresolved');
	});
	it('reports integrity refusals with their actual reason and retains unrelated losses', () => {
		const result = actual([], { notes: ['Application decoding failed. Original transfer preserved.'] });
		expect(compareFields([{ label: 'OHMA Downlink', value: '{broken' }], result, { text: 'OHMA...' })[0]).toMatchObject(
			{
				classification: 'integrity-refusal',
				reason: result.notes[0],
			},
		);
		expect(compareFields([{ label: 'Altitude', value: '123 ft' }], result, input)[0].classification).toBe('unresolved');
	});
});
