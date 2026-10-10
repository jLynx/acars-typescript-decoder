import { describe, expect, it } from 'vitest';
import { Bits } from '@/payload/protocols/bits';
import { position } from '@/payload/protocols/cpdlc-values';
import { routeClearance } from '@/payload/protocols/cpdlc/route';
import { decodeCpdlc } from '@/index';

const integer = (width, value) => value.toString(2).padStart(width, '0');
const text = (value) => [...value].map((char) => integer(7, char.charCodeAt(0))).join('');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (part) => parseInt(part, 2));
const fix = (value) => '0' + integer(3, value.length - 1) + text(value);
const bearing = (value, degrees, trueNorth = false) => fix(value) + Number(trueNorth) + integer(9, degrees - 1);
const coordinate = (latitude, degrees, minutes, negative) =>
	'1' + integer(latitude ? 7 : 8, degrees) + integer(10, minutes) + Number(negative);
const point = coordinate(true, 37, 300, true) + coordinate(false, 174, 60, false);
const route = (item) => '0000000010' + integer(7, 0) + item;

describe('FANS constructed route positions', () => {
	it('decodes place/bearing/distance both as a position and a route item', () => {
		const body = bearing('EMRAG', 90) + '0' + integer(14, 155);
		expect(position(new Bits(bytes('100' + body)))).toBe('EMRAG bearing 90° magnetic / 15.5 NM');
		expect(routeClearance(new Bits(bytes(route('011' + body))))).toBe('EMRAG bearing 90° magnetic / 15.5 NM');
	});
	it('decodes two independently addressed bearings without a length determinant', () => {
		const body = bearing('EMRAG', 90) + bearing('AB', 360, true);
		expect(routeClearance(new Bits(bytes(route('010' + body))))).toBe(
			'EMRAG bearing 90° magnetic / AB bearing 360° true',
		);
	});
	it('consumes the mandatory track coordinate list before the next CPDLC element', () => {
		const track = route('101' + integer(2, 0) + text('NAT') + integer(7, 0) + point);
		const binary = '100' + integer(6, 1) + integer(8, 80) + track + '00' + integer(8, 0);
		expect(decodeCpdlc(bytes(binary), 'uplink')).toMatchObject({
			complete: true,
			summary: 'CLEARED track NAT · -37.5°, 174.1° · UNABLE',
		});
	});
	it('rejects track headers with missing coordinates and overlong published identifiers', () => {
		expect(
			decodeCpdlc(bytes('000' + integer(6, 1) + integer(8, 80) + route('101' + '00' + text('NAT'))), 'uplink').complete,
		).toBe(false);
		expect(() => routeClearance(new Bits(bytes(route('0000' + integer(3, 5) + text('ABCDEF')))))).toThrow();
	});
});
