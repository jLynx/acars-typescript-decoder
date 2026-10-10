import { describe, expect, it } from 'vitest';
import { decodeCpdlc } from '@/index';
import { Bits } from '@/payload/protocols/bits';
import { verticalRate, legType, distance } from '@/payload/protocols/cpdlc/extended';

// Independent bit encoder, using constraints from libacars FANS ASN.1 member types.
const integer = (width, value) => value.toString(2).padStart(width, '0');
const text = (value) => [...value].map((c) => integer(7, c.charCodeAt(0))).join('');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (v) => parseInt(v, 2));
const message = (id, body) => bytes('000' + integer(6, 4) + integer(8, id) + body);
const fix = '000' + integer(3, 4) + text('EMRAG');

describe('additional FANS parameter bodies', () => {
	it.each([171, 172, 173, 174])('decodes vertical-rate message %s with verified English scale', (id) => {
		const result = decodeCpdlc(message(id, '0' + integer(6, 15)), 'uplink');
		expect(result.complete).toBe(true);
		expect(result.summary).toContain('1500 ft/min');
	});
	it('uses metric vertical-rate units and rejects unused constrained encodings', () => {
		expect(verticalRate(new Bits(bytes('1' + integer(8, 25))))).toBe('250 m/min');
		expect(() => verticalRate(new Bits(bytes('0' + integer(6, 61))))).toThrow();
		expect(() => verticalRate(new Bits(bytes('1' + integer(8, 201))))).toThrow();
	});
	it('decodes fuel endurance and people on board without treating endurance as UTC', () => {
		const result = decodeCpdlc(message(57, integer(5, 2) + integer(6, 30) + integer(10, 179)), 'downlink');
		expect(result).toMatchObject({ complete: true, summary: '2 h 30 min OF FUEL REMAINING AND 180 SOULS ON BOARD' });
	});
	it('decodes requests for heading and heading reports', () => {
		for (const id of [35, 36, 70]) {
			const result = decodeCpdlc(message(id, '1' + integer(9, 269)), 'downlink');
			expect(result.complete).toBe(true);
			expect(result.summary).toContain('270° true');
		}
	});
	it('decodes a previously unsupported time-position compound body', () => {
		const result = decodeCpdlc(message(76, integer(5, 12) + integer(6, 34) + fix), 'uplink');
		expect(result).toMatchObject({ complete: true, summary: 'AT 12:34 UTC PROCEED DIRECT TO EMRAG' });
	});
	it('respects the optional holding-leg presence bit preceding the fix', () => {
		const required = fix + '110' + integer(10, 320) + '1' + integer(9, 89) + integer(4, 1);
		expect(decodeCpdlc(message(91, '0' + required), 'uplink')).toMatchObject({
			complete: true,
			summary: 'HOLD AT EMRAG MAINTAIN FL350 INBOUND TRACK 90° true right TURNS',
		});
		expect(decodeCpdlc(message(91, '1' + required + '1' + integer(7, 14)), 'uplink')).toMatchObject({
			complete: true,
			summary: 'HOLD AT EMRAG MAINTAIN FL350 INBOUND TRACK 90° true right TURNS 1.5 min legs',
		});
	});
	it('uses distance rather than distance-offset widths and scales', () => {
		expect(distance(new Bits(bytes('0' + integer(14, 250))))).toBe('25 NM');
		expect(distance(new Bits(bytes('1' + integer(10, 24))))).toBe('25 km');
		expect(legType(new Bits(bytes('00' + integer(10, 99))))).toBe('10 NM legs');
		expect(legType(new Bits(bytes('01' + integer(7, 9))))).toBe('10 km legs');
		expect(() => distance(new Bits(bytes('0' + integer(14, 10000))))).toThrow();
	});
	it('decodes time/distance/to-from/position in the ASN.1 sequence order', () => {
		const result = decodeCpdlc(
			message(78, integer(5, 12) + integer(6, 30) + '0' + integer(14, 250) + '0' + fix),
			'downlink',
		);
		expect(result).toMatchObject({ complete: true, summary: 'AT 12:30 UTC 25 NM to EMRAG' });
	});
	it('retains truncated holding and fuel bodies as partial', () => {
		expect(decodeCpdlc(message(91, '1' + fix), 'uplink').complete).toBe(false);
		expect(decodeCpdlc(message(57, ''), 'downlink').complete).toBe(false);
	});
});
