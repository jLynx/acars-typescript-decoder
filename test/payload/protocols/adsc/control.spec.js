import { describe, expect, it } from 'vitest';
import { decode, decodeLog } from '@/index';
import { decodeAdsc } from '@/payload/protocols/adsc';
import { decodeAdscDisconnect } from '@/payload/protocols/adsc/control';
import { envelope, packed } from './wire';

const field = (result, label) => result.fields.find((item) => item.label === label)?.value;
const parse = (bytes, direction = 'uplink', imi = 'ADS') =>
	decode({ label: 'H1', direction, text: (direction === 'uplink' ? '- #MD/AA ' : '#MDB') + envelope(bytes, imi) });

describe('FANS ADS-C request/control edge cases from pinned libacars and datalink', () => {
	it('decodes an interval after other requested groups and preserves independent request boundaries', () => {
		const bytes = Uint8Array.of(7, 2, 13, 3, 11, 0x81, 21, 4, 5, 8, 9, 20, 10, 40, 2, 7, 1);
		const result = parse(bytes);
		expect(result.coverage).toBe('decoded');
		expect(field(result, 'Requested Predicted route')).toBe('Reporting modulus 3');
		expect(field(result, 'Reporting interval')).toBe('16 seconds');
		expect(field(result, 'Requested Aircraft intent')).toBe('Reporting modulus 4 · projection 5 minutes');
		expect(field(result, 'Event contract')).toBe('9');
		expect(field(result, 'Event trigger')).toBe('Waypoint change');
		expect(field(result, 'Lateral deviation threshold')).toBe('5 NM');
		expect(field(result, 'Cancel contract')).toBe('7');
		expect(field(result, 'Contract control')).toBe('Cancel all contracts');
	});
	it.each([[7], [7, 1, 13], [8, 1, 18], [9, 1, 11], [7, 1, 21, 2]].map((raw) => [raw]))(
		'rejects truncated request %j without exposing application fields',
		(raw) => {
			expect(() => decodeAdsc(Uint8Array.from(raw), 'uplink')).toThrow(/Truncated/);
			const result = parse(Uint8Array.from(raw));
			expect(result.coverage).toBe('partial');
			expect(field(result, 'Application CRC')).toContain('Verified');
			expect(field(result, 'Periodic contract')).toBeUndefined();
		},
	);
	it('retains interval-less contract fields as partial without inventing an interval', () => {
		for (const bytes of [Uint8Array.of(7, 1, 13, 1), Uint8Array.of(9, 2)]) {
			const result = parse(bytes);
			expect(result.coverage).toBe('partial');
			expect(field(result, 'Reporting interval')).toBeUndefined();
			expect(result.notes.join(' ')).toContain('no reporting interval');
		}
	});
	it.each([
		[0, '0 seconds'],
		[63, '0 seconds'],
		[64, '1 seconds'],
		[127, '64 seconds'],
		[128, '8 seconds'],
		[191, '512 seconds'],
		[192, '64 seconds'],
		[255, '4096 seconds'],
	])('decodes reporting-interval boundary %i', (code, expected) => {
		expect(field(parse(Uint8Array.of(9, 3, 11, code)), 'Reporting interval')).toBe(expected);
	});
	it.each([
		[-128, '< 8192 ft/min'],
		[-1, '< 64 ft/min'],
		[0, '> 0 ft/min'],
		[127, '> 8128 ft/min'],
	])('preserves vertical-threshold comparator %i', (raw, expected) => {
		expect(field(parse(Uint8Array.of(8, 1, 18, raw & 255)), 'Vertical speed threshold')).toBe(expected);
	});
	it('retains repeated group declarations and unknown trailing tags without guessing their length', () => {
		const result = decodeAdsc(Uint8Array.of(7, 1, 11, 64, 13, 2, 13, 3, 0xfe, 1), 'uplink');
		expect(result.complete).toBe(false);
		expect(
			result.fields.filter((item) => item.label === 'Requested Predicted route').map((item) => item.value),
		).toEqual(['Reporting modulus 2', 'Reporting modulus 3']);
		expect(result.notes.join(' ')).toContain('tag 254');
	});
	it('keeps duplicate and incompatible groups partial even when every byte has a known layout', () => {
		for (const bytes of [
			Uint8Array.of(7, 1, 11, 64, 13, 2, 13, 3),
			Uint8Array.of(7, 1, 11, 64, 20),
			Uint8Array.of(8, 1, 11, 64),
			Uint8Array.of(8, 1),
		]) {
			const result = parse(bytes);
			expect(result.coverage).toBe('partial');
			expect(result.notes.join(' ')).toMatch(/Duplicate|not valid|no event triggers/);
		}
	});
	it.each([
		[1, 3, 'Duplicate group tag', 'Erroneous octet number'],
		[2, 4, 'Duplicate reporting interval tag', 'Erroneous octet number'],
		[7, 21, 'Undefined contract request tag', 'Erroneous tag number'],
	])('interprets NACK extension for reason %i', (reason, extension, meaning, label) => {
		const result = parse(Uint8Array.of(4, 9, reason, extension, 3, 8), 'downlink');
		expect(result.coverage).toBe('decoded');
		expect(field(result, 'Contract rejection reason')).toBe(meaning);
		expect(field(result, label)).toBe(String(extension));
		expect(field(result, 'Acknowledged contract')).toBe('8');
		expect(() => decodeAdsc(Uint8Array.of(4, 9, reason), 'downlink')).toThrow();
	});
	it.each([0, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13])('consumes no extension for NACK reason %i', (reason) => {
		const result = parse(Uint8Array.of(4, 9, reason, 3, 8), 'downlink');
		expect(result.coverage).toBe('decoded');
		expect(field(result, 'Acknowledged contract')).toBe('8');
	});
	it.each([14, 255])('rejects unassigned NACK reason %i', (reason) => {
		expect(() => decodeAdsc(Uint8Array.of(4, 1, reason), 'downlink')).toThrow(/reason/);
		expect(field(parse(Uint8Array.of(4, 1, reason), 'downlink'), 'Rejected contract')).toBeUndefined();
	});
	it.each([
		[0x00, '0', 'Reason not specified'],
		[0x10, '1', 'Congestion'],
		[0x20, '2', 'Application not available'],
		[0x80, '8', 'Normal disconnect'],
	])('decodes DIS reason high nibble %i', (value, code, reason) => {
		const result = parse(Uint8Array.of(value), 'downlink', 'DIS');
		expect(result.coverage).toBe('decoded');
		expect(field(result, 'Disconnect reason code')).toBe(code);
		expect(field(result, 'Disconnect reason')).toBe(reason);
		expect(field(result, 'Payload parser')).toContain('ADS-C');
	});
	it.each([0x30, 0xff, 0x81])('retains unknown DIS fields as partial %i', (value) => {
		const result = parse(Uint8Array.of(value), 'downlink', 'DIS');
		expect(result.coverage).toBe('partial');
		expect(field(result, 'Disconnect octet (raw)')).toBe(value.toString(16).padStart(2, '0').toUpperCase());
	});
	it('rejects empty/multiple DIS octets and checks CRC before exposing reason semantics', () => {
		for (const bytes of [new Uint8Array(), Uint8Array.of(0x80, 0)]) {
			expect(() => decodeAdscDisconnect(bytes)).toThrow();
			expect(field(parse(bytes, 'downlink', 'DIS'), 'Disconnect reason')).toBeUndefined();
		}
		const text = envelope(Uint8Array.of(0x80), 'DIS');
		const result = decode({ label: 'H1', text: text.slice(0, -4) + '0000' });
		expect(field(result, 'Application CRC')).toContain('Failed');
		expect(field(result, 'Disconnect reason')).toBeUndefined();
	});
	it('validates the six-bit flight alphabet and preserves signed weather/velocity expectations', () => {
		const valid = packed([8, 12], ...[1, 26, 48, 57, 32, 32, 32, 32].map((value) => [6, value]));
		expect(field(parse(valid, 'downlink'), 'Reported flight')).toBe('AZ09');
		for (const invalid of [0, 27, 31, 33, 47, 58, 63]) {
			const bytes = packed([8, 12], [6, invalid], ...new Array(7).fill([6, 32]));
			expect(() => decodeAdsc(bytes, 'downlink')).toThrow(/character/);
		}
		const bytes = packed(
			[8, 14],
			[1, 0],
			[12, -1024],
			[13, 1],
			[12, -1],
			[2, 0],
			[8, 16],
			[9, 511],
			[1, 1],
			[9, -1],
			[12, -256],
			[1, 0],
		);
		const result = parse(bytes, 'downlink');
		expect(field(result, 'True track')).toBe('270°');
		expect(field(result, 'Ground speed')).toBe('0.5 kt');
		expect(field(result, 'Ground vertical rate')).toBe('-16 ft/min');
		expect(field(result, 'Wind speed')).toBe('255.5 kt');
		expect(field(result, 'True wind direction')).toBe('Unavailable');
		expect(field(result, 'Temperature')).toBe('-64 °C');
	});
	it('decodes a completed H1 radio assembly and leaves originals intact', () => {
		const body = envelope(Uint8Array.of(8, 1, 18, 255));
		const base = { label: 'H1', direction: 'uplink', registration: 'N123AB', flight: 'TEST1', receivedAt: 1000 };
		const blocks = [
			{ ...base, id: 1, blockId: 'A', text: '- #MD/AA ' + body.slice(0, 15), continuation: true },
			{ ...base, id: 2, blockId: 'B', text: '- #MD/AA ' + body.slice(15), continuation: false, receivedAt: 1001 },
		];
		const result = decodeLog(blocks);
		expect(field(result[1].interpretation, 'Vertical speed threshold')).toBe('< 64 ft/min');
		expect(result.map((item) => item.text)).toEqual(blocks.map((item) => item.text));
	});
	it('rejects invalid runtime direction and oversized buffers', () => {
		expect(() => decodeAdsc(Uint8Array.of(1), 'unknown')).toThrow(/direction/);
		expect(() => decodeAdsc(new Uint8Array(8193), 'uplink')).toThrow();
	});
});
