import { describe, expect, it } from 'vitest';
import { Bits } from '@/payload/protocols/bits';
import { speed, procedure } from '@/payload/protocols/cpdlc-values';
import { decode, decodeCpdlc } from '@/index';
import { envelope } from '../adsc/wire';

// Constraints independently transcribed from MIT libacars generated ASN.1 descriptors.
const integer = (width, value) => BigInt(value).toString(2).padStart(width, '0');
const text = (value) => [...value].map((char) => integer(7, char.charCodeAt(0))).join('');
const wire = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (octet) => parseInt(octet, 2));
const limits = [
	[5, 7, 38],
	[7, 10, 137],
	[6, 7, 70],
	[7, 10, 137],
	[6, 7, 70],
	[8, 10, 265],
	[5, 61, 92],
	[9, 93, 604],
];

describe('FANS CPDLC schema bounds and corrupt-message gating', () => {
	it.each(limits.map((row, choice) => [choice, ...row]))(
		'verifies both bounds of speed choice %i',
		(choice, width, minimum, maximum) => {
			for (const value of [minimum, maximum]) {
				const result = speed(new Bits(wire(integer(3, choice) + integer(width, value - minimum))));
				expect(result).toBe(
					choice >= 6
						? `Mach ${(value / 100).toFixed(2)}`
						: `${value * 10} ${choice % 2 ? 'km/h' : 'kt'} (${['IAS', 'IAS', 'TAS', 'TAS', 'ground', 'ground'][choice]})`,
				);
			}
		},
	);
	it('checks all valid wire codepoints of all eight speed alternatives', () => {
		for (const [choice, [width, minimum, maximum]] of limits.entries()) {
			for (let value = minimum; value <= maximum; value++)
				expect(() => speed(new Bits(wire(integer(3, choice) + integer(width, value - minimum))))).not.toThrow();
		}
	});
	it('consumes procedure and transition fields with exact maximum lengths', () => {
		const binary = '1' + integer(2, 2) + integer(3, 5) + text('SID123') + integer(3, 4) + text('TRANS');
		expect(procedure(new Bits(wire(binary)))).toBe('departure SID123 transition TRANS');
		expect(decodeCpdlc(wire('000' + integer(6, 4) + integer(8, 23) + binary), 'downlink')).toMatchObject({
			complete: true,
			summary: 'REQUEST departure SID123 transition TRANS',
		});
	});
	it.each([6, 7])('rejects unused procedure length codepoint %i', (length) => {
		expect(() => procedure(new Bits(wire('0' + integer(2, 0) + integer(3, length) + text('ABCDEFGH'))))).toThrow();
	});
	it.each([5, 6, 7])('rejects unused transition length codepoint %i', (length) => {
		expect(() =>
			procedure(new Bits(wire('1' + integer(2, 0) + '000' + text('A') + integer(3, length) + text('ABCDEFGH')))),
		).toThrow();
	});
	it('keeps malformed instructions partial after a verified ARINC CRC', () => {
		const body = wire('000' + integer(6, 4) + integer(8, 23) + '0' + integer(2, 0) + integer(3, 6) + text('ABCDEFG'));
		const result = decode({ label: 'H1', text: `#M1B${envelope(body, 'AT1')}` });
		expect(result.coverage).toBe('partial');
		expect(result.fields.find((item) => item.label === 'Application CRC').value).toContain('Verified');
		expect(result.fields.find((item) => item.label === 'CPDLC instruction 1').value).toContain('undecoded');
	});
	it('validates direction/input/bounds at the public binary reader', () => {
		expect(() => decodeCpdlc(new Uint8Array(8193), 'uplink')).toThrow();
		expect(() => decodeCpdlc(Uint8Array.of(0), 'guess')).toThrow();
		expect(() => decodeCpdlc([0], 'downlink')).toThrow();
	});
});
