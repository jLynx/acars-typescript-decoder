import { describe, expect, it } from 'vitest';
import { decode, decodeAdsc } from '@/index';
import { envelope, packed } from './wire';

const field = (result, label) => result.fields.find((item) => item.label === label)?.value;
const parse = (bytes) => decode({ label: 'H1', direction: 'downlink', text: '#MDB' + envelope(bytes) });
const position = [
	[21, -262144],
	[21, 524288],
	[16, -1],
];
const basic = (tag, status = 31) => packed([8, tag], ...position, [15, 1], [7, status]);
const velocity = (tag, remainder = 0) => packed([8, tag], [1, 0], [12, -2048], [13, 8191], [12, -2048], [2, remainder]);
const weather = (remainder = 0) => packed([8, 16], [9, 511], [1, 0], [9, -256], [12, -2048], [1, remainder]);
const route = (remainder = 0) =>
	packed([8, 13], ...position, [14, 16383], [21, 262144], [21, -524288], [16, 32767], [6, remainder]);
const intermediate = (remainder = 0) =>
	packed([8, 22], [16, 65535], [1, 0], [12, -1024], [16, -32768], [14, 16383], [5, remainder]);
const fixed = () => packed([8, 23], ...position, [14, 16383]);
const tags = [3, 4, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23];
const wire = (tag) => {
	if ([7, 9, 10, 18, 19, 20].includes(tag)) return basic(tag);
	if (tag === 3) return Uint8Array.of(3, 255);
	if (tag === 4) return Uint8Array.of(4, 255, 7, 21);
	if (tag === 5) return Uint8Array.of(5, 255, 1, 14, 3, 0x12, 0x30);
	if (tag === 6) return Uint8Array.of(6);
	if (tag === 12) return packed([8, 12], ...[1, 26, 48, 57, 32, 32, 32, 32].map((code) => [6, code]));
	if (tag === 13) return route();
	if (tag === 14 || tag === 15) return velocity(tag);
	if (tag === 16) return weather();
	if (tag === 17) return Uint8Array.of(17, 0xff, 0x80, 0x01);
	return tag === 22 ? intermediate() : fixed();
};

describe('independently packed FANS ADS-C report field expectations', () => {
	it.each([7, 9, 10, 18, 19, 20])('checks signed position and eighth-second timestamp for basic family %i', (tag) => {
		const result = parse(basic(tag));
		expect(result.coverage).toBe('decoded');
		expect(field(result, 'Latitude')).toBe('-45°');
		expect(field(result, 'Longitude')).toBe('90°');
		expect(field(result, 'Altitude')).toBe('-4 ft');
		expect(field(result, 'Report time')).toBe('0.125 seconds past the hour (date/hour not supplied)');
		expect(field(result, 'Navigation redundancy')).toBe('Available');
		expect(field(result, 'TCAS')).toBe('Available');
	});
	it.each(['Navigation capability lost', '< 30 NM', '< 15 NM', '< 8 NM', '< 4 NM', '< 1 NM', '< 0.25 NM', '< 0.05 NM'])(
		'checks independently listed navigation accuracy %s',
		(meaning) => {
			const code = [
				'Navigation capability lost',
				'< 30 NM',
				'< 15 NM',
				'< 8 NM',
				'< 4 NM',
				'< 1 NM',
				'< 0.25 NM',
				'< 0.05 NM',
			].indexOf(meaning);
			const result = parse(basic(7, code * 2));
			expect(field(result, 'Position accuracy code')).toBe(String(code));
			expect(field(result, 'Position accuracy')).toBe(meaning);
			expect(field(result, 'Navigation redundancy')).toBe('Unavailable');
			expect(field(result, 'TCAS')).toBe('Unavailable');
		},
	);
	it.each([14, 15])('checks signed angle/rate and maximum speed for reference group %i', (tag) => {
		const result = parse(velocity(tag));
		expect(field(result, tag === 14 ? 'True track' : 'True heading')).toBe('180°');
		expect(field(result, tag === 14 ? 'Ground speed' : 'Mach')).toBe(tag === 14 ? '4095.5 kt' : '4.0955');
		expect(field(result, tag === 14 ? 'Ground vertical rate' : 'Air vertical rate')).toBe('-32768 ft/min');
		const unavailable = packed([8, tag], [1, 1], [12, 2047], [13, 0], [12, 2047], [2, 0]);
		expect(field(parse(unavailable), tag === 14 ? 'True track' : 'True heading')).toBe('Unavailable');
		expect(field(parse(unavailable), tag === 14 ? 'Ground vertical rate' : 'Air vertical rate')).toBe('32752 ft/min');
	});
	it('checks independent weather extrema, direction and temperature sign', () => {
		const result = parse(weather());
		expect(field(result, 'Wind speed')).toBe('255.5 kt');
		expect(field(result, 'True wind direction')).toBe('180°');
		expect(field(result, 'Temperature')).toBe('-512 °C');
		const other = packed([8, 16], [9, 0], [1, 1], [9, 255], [12, 2047], [1, 0]);
		expect(field(parse(other), 'True wind direction')).toBe('Unavailable');
		expect(field(parse(other), 'Temperature')).toBe('511.75 °C');
	});
	it('checks next/following waypoint fields and 14-bit ETA', () => {
		const result = parse(route());
		expect(field(result, 'Next waypoint Latitude')).toBe('-45°');
		expect(field(result, 'Next waypoint Longitude')).toBe('90°');
		expect(field(result, 'Next waypoint Altitude')).toBe('-4 ft');
		expect(field(result, 'Next waypoint ETA')).toBe('16383 seconds');
		expect(field(result, 'Following waypoint Latitude')).toBe('45°');
		expect(field(result, 'Following waypoint Longitude')).toBe('-90°');
		expect(field(result, 'Following waypoint Altitude')).toBe('131068 ft');
	});
	it('checks eighth-NM distance, signed altitude and fixed projections', () => {
		const result = parse(intermediate());
		expect(field(result, 'Projected distance')).toBe('8191.875 NM');
		expect(field(result, 'Projected track')).toBe('270°');
		expect(field(result, 'Projected altitude')).toBe('-131072 ft');
		expect(field(result, 'Projection time')).toBe('16383 seconds');
		const fix = parse(fixed());
		expect(field(fix, 'Projected Latitude')).toBe('-45°');
		expect(field(fix, 'Projected Longitude')).toBe('90°');
		expect(field(fix, 'Projected Altitude')).toBe('-4 ft');
		expect(field(fix, 'Projection time')).toBe('16383 seconds');
	});
	it('reads odd/even noncompliant parameter lists, flags and following tag without shifting', () => {
		const bytes = Uint8Array.of(5, 255, 4, 14, 3, 0x12, 0x30, 15, 2, 0x45, 16, 0x8f, 17, 0x4f, 3, 42);
		const result = parse(bytes);
		expect(result.coverage).toBe('decoded');
		expect(field(result, 'Noncompliant group count')).toBe('4');
		expect(field(result, 'Noncompliant group 14')).toBe('Parameter codes: 1, 2, 3');
		expect(field(result, 'Noncompliant group 15')).toBe('Parameter codes: 4, 5');
		expect(field(result, 'Noncompliant group 16')).toBe('Unrecognized');
		expect(field(result, 'Noncompliant group 17')).toBe('Unavailable');
		expect(field(result, 'Noncompliant group 16 flags/count (raw)')).toBe('10/15');
		expect(field(result, 'Acknowledged contract')).toBe('42');
		expect(field(parse(Uint8Array.of(5, 1, 0)), 'Noncompliant group count')).toBe('0');
		expect(field(parse(wire(12)), 'Reported flight')).toBe('AZ09');
		expect(field(parse(wire(17)), 'ICAO aircraft address')).toBe('FF8001');
		expect(field(parse(wire(6)), 'Emergency mode')).toBe('Cancelled');
	});
	it.each([
		[basic(7, 127), 'Basic report status remainder (raw)', '3'],
		[velocity(14, 3), 'Earth reference remainder (raw)', '3'],
		[velocity(15, 2), 'Air reference remainder (raw)', '2'],
		[weather(1), 'Meteorological report remainder (raw)', '1'],
		[route(63), 'Predicted route remainder (raw)', '63'],
		[intermediate(31), 'Intermediate projection remainder (raw)', '31'],
		[Uint8Array.of(5, 1, 1, 14, 0x31, 0x1f), 'Noncompliant group 14 parameter padding (raw)', '15'],
	])('retains unassigned report bits as partial: %s', (bytes, label, value) => {
		const result = parse(bytes);
		expect(result.coverage).toBe('partial');
		expect(field(result, label)).toBe(value);
		expect(result.notes.join(' ')).toContain('unassigned bits');
	});
	it.each(tags)('checks known downlink tag %i, all truncated byte prefixes and CRC failure', (tag) => {
		const bytes = wire(tag);
		expect(parse(bytes).coverage).toBe('decoded');
		for (let length = 0; length < bytes.length; length++) {
			const truncated = bytes.slice(0, length);
			expect(() => decodeAdsc(truncated, 'downlink')).toThrow();
			expect(parse(truncated).coverage).toBe('partial');
		}
		const text = '#MDB' + envelope(bytes);
		const corrupt = text.slice(0, -1) + (text.endsWith('0') ? '1' : '0');
		const result = decode({ label: 'H1', direction: 'downlink', text: corrupt });
		expect(field(result, 'Application CRC')).toContain('Failed');
		expect(field(result, 'Payload parser')).toBeUndefined();
	});
	it('bounds latitude and combined group count while retaining unknown tag boundaries', () => {
		const valid = packed([8, 7], [21, 524288], [21, -1048576], [16, -32768], [15, 32767], [7, 0]);
		expect(field(parse(valid), 'Latitude')).toBe('90°');
		expect(field(parse(valid), 'Longitude')).toBe('-180°');
		const invalid = packed([8, 7], [21, 524289], [21, 0], [16, 0], [15, 0], [7, 0]);
		expect(() => decodeAdsc(invalid, 'downlink')).toThrow(/position/);
		expect(() => decodeAdsc(Uint8Array.from(Array(201).fill(6)), 'downlink')).toThrow(/Too many/);
		const unknown = decodeAdsc(Uint8Array.of(3, 42, 255, 7, 0), 'downlink');
		expect(unknown.complete).toBe(false);
		expect(field(unknown, 'Acknowledged contract')).toBe('42');
		expect(unknown.notes.join(' ')).toContain('tag 255');
	});
});
