import { describe, expect, it } from 'vitest';
import { Bits } from '@/payload/protocols/bits';
import { routeClearance } from '@/payload/protocols/cpdlc/route';
import { decodeCpdlc } from '@/index';

const integer = (width, value) => value.toString(2).padStart(width, '0');
const text = (value) => [...value].map((char) => integer(7, char.charCodeAt(0))).join('');
const fix = (value) => '000' + integer(3, value.length - 1) + text(value);
const level = (fl) => '110' + integer(10, fl - 30);
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (part) => parseInt(part, 2));
const route = (body) => '0000000001' + body;
const read = (body) => routeClearance(new Bits(bytes(route(body))));

describe('FANS additional route schema structures', () => {
	it('decodes along-track and waypoint speed/altitude lists in ASN.1 optional member order', () => {
		const body =
			'100010' +
			'000' +
			'11' +
			fix('EMRAG') +
			'1' +
			'0' +
			integer(14, 155) +
			'000' +
			integer(5, 18) +
			'1' +
			'01' +
			level(340) +
			'10' +
			level(360) +
			'00000' +
			'01' +
			fix('AB') +
			'0' +
			'00' +
			level(350);
		expect(read(body)).toBe(
			'along track EMRAG -15.5 NM · 250 kt (IAS) · at or above FL340 · at or below FL360 · waypoint AB · at FL350',
		);
	});
	it('reads reporting hemisphere before degrees, then the optional degree increment', () => {
		expect(read('010000' + '1' + '1' + '1' + integer(8, 170) + integer(5, 4))).toBe('report at 170°W every 5°');
	});
	it('reads intercept choice and course before the next independent element', () => {
		const additional = '001000' + '00' + '00' + '0' + integer(3, 1) + text('AB') + '1' + integer(9, 89);
		const binary = '100' + integer(6, 1) + integer(8, 80) + route(additional) + '00' + integer(8, 0);
		expect(decodeCpdlc(bytes(binary), 'uplink')).toMatchObject({
			complete: true,
			summary: 'CLEARED intercept from AB course 90° true · UNABLE',
		});
	});
	it('reads every holding optional field without a trailing bitmap', () => {
		const body =
			'000100' +
			'000' +
			'1111111' +
			fix('AB') +
			'000' +
			integer(5, 10) +
			'00' +
			level(350) +
			'000' +
			integer(5, 18) +
			'0001' +
			'0' +
			integer(9, 179) +
			integer(5, 12) +
			integer(6, 30) +
			'1' +
			integer(7, 14);
		expect(read(body)).toBe(
			'hold at AB · low speed 170 kt (IAS) · at FL350 · high speed 250 kt (IAS) · right turns · inbound 180° magnetic · expect further clearance 12:30 UTC · 1.5 min legs',
		);
	});
	it('reads required arrival time, time tolerance and explicit RTA units', () => {
		const body = '000001' + '00000' + '1' + fix('AB') + integer(5, 12) + integer(6, 30) + '10' + integer(8, 14);
		expect(read(body)).toBe('required arrival AB at or before 12:30 UTC tolerance 1.5 min');
	});
	it('rejects invalid tolerance, degree increments, intercept lengths and truncations', () => {
		expect(() => read('000001' + '00000' + '0' + fix('AB') + integer(5, 12) + integer(6, 30) + '11')).toThrow();
		expect(() => read('010000' + '1' + '0' + '0' + integer(7, 30) + '11111')).toThrow();
		expect(() => routeClearance(new Bits(bytes('0000000100' + '111' + text('ABCDEFGH'))))).toThrow();
		expect(() => read('100000' + '111')).toThrow();
	});
});
