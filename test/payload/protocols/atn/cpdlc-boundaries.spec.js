import { describe, expect, it } from 'vitest';
import { decodeAtnCpdlc } from '@/index';
import { nodes, wire } from './cpdlc-wire';

const entries = Object.entries(nodes);
const width = (minimum, maximum) => Math.ceil(Math.log2(maximum - minimum + 1));
const ranges = entries.filter(
	([, node]) =>
		node.kind === 'constrained_integer' && node.maximum - node.minimum + 1 < 2 ** width(node.minimum, node.maximum),
);
const strings = entries.filter(
	([, node]) =>
		['restricted_character_string', 'NumericString'].includes(node.kind) &&
		node.maximum - node.minimum + 1 < 2 ** width(node.minimum, node.maximum),
);
const lists = entries.filter(
	([, node]) =>
		node.kind === 'constrained_sequence_of' && node.maximum - node.minimum + 1 < 2 ** width(node.minimum, node.maximum),
);
const choices = entries
	.filter(([, node]) => node.kind === 'choice')
	.map(([type, node]) => [type, node.members.filter((member) => !member.extension).length])
	.filter(([, count]) => count < 2 ** width(0, count - 1));

describe('ATN CPDLC malformed constrained encoding matrix', () => {
	it.each(ranges)('rejects unused scalar boundary for %s', (type, node) => {
		for (const value of [node.maximum + 1, node.minimum + 2 ** width(node.minimum, node.maximum) - 1]) {
			const fixture = wire(type, value);
			expect(() => decodeAtnCpdlc(fixture.bytes, fixture.options)).toThrow();
		}
	});
	it.each(strings)('rejects every unused string length for %s', (type, node) => {
		for (let length = node.maximum + 1; length < node.minimum + 2 ** width(node.minimum, node.maximum); length++) {
			const fixture = wire(type, { length });
			expect(() => decodeAtnCpdlc(fixture.bytes, fixture.options)).toThrow();
		}
	});
	it.each(lists)('rejects every unused list length for %s', (type, node) => {
		for (let count = node.maximum + 1; count < node.minimum + 2 ** width(node.minimum, node.maximum); count++) {
			const fixture = wire(type, count);
			expect(() => decodeAtnCpdlc(fixture.bytes, fixture.options)).toThrow();
		}
	});
	it.each(choices)('rejects every unused root CHOICE for %s', (type, count) => {
		for (let choice = count; choice < 2 ** width(0, count - 1); choice++) {
			const fixture = wire(type, choice);
			expect(() => decodeAtnCpdlc(fixture.bytes, fixture.options)).toThrow();
		}
	});
	it.each(entries.filter(([, node]) => node.kind === 'enumerated' && node.count < 2 ** width(0, node.count - 1)))(
		'rejects every unused root enum for %s',
		(type, node) => {
			for (let value = node.count; value < 2 ** width(0, node.count - 1); value++) {
				const fixture = wire(type, value);
				expect(() => decodeAtnCpdlc(fixture.bytes, fixture.options)).toThrow();
			}
		},
	);
	it.each([11, 12, 13, 14, 15])('rejects NumericString unused alphabet %i', (code) => {
		const fixture = wire('Frequencysatchannel', { length: 12, code });
		expect(() => decodeAtnCpdlc(fixture.bytes, fixture.options)).toThrow();
	});
});
