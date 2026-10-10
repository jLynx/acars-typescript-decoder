import { describe, expect, it } from 'vitest';
import { decodeAtnCm } from '@/index';
import { decodeAtnCm as formatsCm } from '@/formats';

// Independent X.691 bit encoding based on Doc9705 Ed2 CMMessageSetVersion1.
const int = (value, width) => (width ? BigInt(value).toString(2).padStart(width, '0') : '');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g) ?? [], (v) => parseInt(v, 2));
const chars = (value) => [...value].map((c) => int(c.charCodeAt(0), 7)).join('');
const text = (value, width, minimum) => int(value.length - minimum, width) + chars(value);
const octets = (values) => values.map((v) => int(v, 8)).join('');
const short = (reference = true, count = 11) =>
	(reference ? '1' + octets([0xab, 0xcd, 0xef]) : '0') +
	int(count - 10, 1) +
	octets(Array.from({ length: count }, (_, i) => i));
const long = (reference = true, count = 11) => octets([1, 2, 3, 4, 5]) + short(reference, count);
const applications = (count, addressed, shortOnly = false) =>
	int(count - 1, 8) +
	(int(22, 8) + int(254, 8) + (addressed ? (shortOnly ? '1' + short(false, 10) : '0' + long()) : '')).repeat(count);
const flags = (mask) => int(mask, 6);
const logon = (mask = 0, count = 1) =>
	flags(mask) +
	text('TEST1234', 3, 2) +
	long() +
	(mask & 32 ? applications(count, true) : '') +
	(mask & 16 ? applications(count, false) : '') +
	(mask & 8 ? text('ATSU1234', 3, 4) : '') +
	(mask & 4 ? chars('NZAA') : '') +
	(mask & 2 ? chars('ZGSZ') : '') +
	(mask & 1 ? int(2024 - 1996, 7) + int(1, 4) + int(28, 5) + int(23, 5) + int(59, 6) : '');
const root = (direction, choice, body = '') => '0' + int(choice, direction === 'uplink' ? 3 : 2) + body;
const parse = (binary, direction = 'downlink') => decodeAtnCm(bytes(binary), direction, binary.length);

describe('Doc9705 CM version 1 with explicit direction', () => {
	it.each([decodeAtnCm, formatsCm])('reads independent logon addresses and optional operational data', (reader) => {
		const binary = root('downlink', 0, logon(63));
		const wire = bytes(binary);
		const result = reader(wire, 'downlink', binary.length);
		expect(result).toMatchObject({
			type: 'logon-request',
			version: 1,
			flightIdentification: 'TEST1234',
			facility: 'ATSU1234',
			departure: 'NZAA',
			destination: 'ZGSZ',
			structureComplete: true,
			integrity: 'unverified',
		});
		expect(result.address).toEqual({
			format: 'long-tsap',
			routingDomainPart: Uint8Array.of(1, 2, 3, 4, 5),
			addressReference: Uint8Array.of(0xab, 0xcd, 0xef),
			localSystemNselTsel: Uint8Array.from({ length: 11 }, (_, i) => i),
		});
		expect(result.addressedApplications[0]).toMatchObject({ aeQualifier: 22, version: 255 });
		expect(result.otherApplications).toEqual([{ aeQualifier: 22, version: 255 }]);
		expect(result.departureDateTime).toEqual({
			year: 2024,
			month: 2,
			day: 29,
			hour: 23,
			minute: 59,
			calendarValid: true,
		});
		expect(result.notes.join(' ')).toContain('bilateral agreement');
		wire.fill(0);
		expect(result.raw).toEqual(bytes(binary));
	});
	it('covers every logon optional bitmap combination', () => {
		for (let mask = 0; mask < 64; mask++) {
			const result = parse(root('downlink', 0, logon(mask)));
			expect(result.structureComplete).toBe(true);
			for (const [bit, key] of [
				[32, 'addressedApplications'],
				[16, 'otherApplications'],
				[8, 'facility'],
				[4, 'departure'],
				[2, 'destination'],
				[1, 'departureDateTime'],
			])
				expect(result[key] !== undefined).toBe(Boolean(mask & bit));
		}
	});
	it.each([0, 1])('reads all logon-response/update application flag combinations for choice %i', (choice) => {
		for (let mask = 0; mask < 4; mask++) {
			const body =
				int(mask, 2) + (mask & 2 ? applications(1, true, true) : '') + (mask & 1 ? applications(1, false) : '');
			const result = parse(root('uplink', choice, body), 'uplink');
			expect(result.structureComplete).toBe(true);
			if (mask & 2)
				expect(result.addressedApplications[0].address).toMatchObject({
					format: 'short-tsap',
					localSystemNselTsel: Uint8Array.from({ length: 10 }, (_, i) => i),
				});
		}
	});
	it('reads contact and forwarded logon without changing known direction', () => {
		const contact = parse(root('uplink', 2, text('ATSU', 3, 4) + long(false, 10)), 'uplink');
		expect(contact.facility).toBe('ATSU');
		expect(contact.address.addressReference).toBeUndefined();
		expect(contact.structureComplete).toBe(true);
		expect(parse(root('uplink', 3, logon()), 'uplink').type).toBe('forward-request');
	});
	it.each([0, 1])('reads contact-response enum %i', (code) => {
		expect(parse(root('downlink', 1, String(code))).response).toEqual({
			code,
			meaning: code ? 'Contact not successful' : 'Contact success',
		});
	});
	it.each([0, 1, 2])('reads forward-response enum %i', (code) => {
		expect(parse(root('uplink', 5, int(code, 2)), 'uplink').response.code).toBe(code);
	});
	it.each(['uplink', 'downlink'])('reads every abort root/extension code with known %s direction', (direction) => {
		for (let code = 0; code < 10; code++) {
			const result = parse(root(direction, direction === 'uplink' ? 4 : 2, '0' + int(code, 4)), direction);
			expect(result.response.code).toBe(code);
			expect(result.response.meaning).not.toContain('Unassigned');
		}
		const extension = parse(root(direction, direction === 'uplink' ? 4 : 2, '1' + '0000001'), direction);
		expect(extension.response).toEqual({ code: 11, meaning: 'Unassigned extension' });
	});
	it('reads maximum 256-entry application lists and version/qualifier extrema', () => {
		const result = parse(root('uplink', 0, '01' + applications(256, false)), 'uplink');
		expect(result.otherApplications).toHaveLength(256);
		expect(result.structureComplete).toBe(true);
		const minimal = parse(root('uplink', 0, '01' + int(0, 8) + int(0, 8) + int(0, 8)), 'uplink');
		expect(minimal.otherApplications).toEqual([{ aeQualifier: 0, version: 1 }]);
	});
	it('retains root CHOICE extensions as open types', () => {
		const result = parse('1' + '0000001' + int(2, 8) + octets([0xaa, 0x55]));
		expect(result.type).toBe('extension');
		expect(result.extension).toEqual({ index: 1, payload: Uint8Array.of(0xaa, 0x55) });
		expect(result.structureComplete).toBe(true);
	});
	it('retains ASN.1-compliant invalid calendar dates with explicit validity', () => {
		const binary = root(
			'downlink',
			0,
			flags(1) + text('AB', 3, 2) + long() + int(2023 - 1996, 7) + int(1, 4) + int(28, 5) + int(0, 5) + int(0, 6),
		);
		const result = parse(binary);
		expect(result.departureDateTime.calendarValid).toBe(false);
		expect(result.departureDateTime.day).toBe(29);
		expect(result.notes.join(' ')).toContain('Calendar date is invalid');
	});
	it('rejects unused constrained string/date/version/choice values and malformed boundaries', () => {
		for (const [direction, binary] of [
			['downlink', root('downlink', 3)],
			['uplink', root('uplink', 6)],
			['uplink', root('uplink', 5, '11')],
			['downlink', root('downlink', 2, '0' + int(10, 4))],
			['downlink', root('downlink', 0, flags(0) + '111' + chars('ABCDEFGHI') + long())],
			['uplink', root('uplink', 0, '01' + int(0, 8) + int(0, 8) + int(255, 8))],
			['uplink', root('uplink', 2, '101' + chars('ABCDEFGHI') + long())],
			['downlink', root('downlink', 0, flags(1) + text('AB', 3, 2) + long() + int(127, 7))],
		])
			expect(() => parse(binary, direction)).toThrow();
		const binary = root('downlink', 0, logon(63));
		for (let length = 0; length < bytes(binary).length; length++)
			expect(() => decodeAtnCm(bytes(binary).slice(0, length), 'downlink')).toThrow();
		expect(() => decodeAtnCm(bytes(binary), 'downlink', binary.length - 1)).toThrow();
	});
	it('retains padding/trailing bytes and enforces input/direction/bit limits', () => {
		const binary = root('downlink', 1, '1');
		const wire = bytes(binary);
		wire[0] |= 1;
		expect(decodeAtnCm(wire, 'downlink').structureComplete).toBe(false);
		expect(decodeAtnCm(Uint8Array.from([...bytes(binary), 0]), 'downlink').structureComplete).toBe(false);
		expect(() => decodeAtnCm(new Uint8Array(8193), 'downlink')).toThrow();
		expect(() => decodeAtnCm(bytes(binary), 'guess')).toThrow();
		expect(() => decodeAtnCm(bytes(binary), 'downlink', 0)).toThrow();
	});
	it('checks calendar/clock extrema and every unused calendar/clock codepoint', () => {
		const prefix = root('downlink', 0, flags(1) + text('AB', 3, 2) + long());
		const date = (year, month, day, hour, minute) =>
			int(year - 1996, 7) + int(month - 1, 4) + int(day - 1, 5) + int(hour, 5) + int(minute, 6);
		for (const values of [
			[1996, 1, 1, 0, 0],
			[2095, 12, 31, 23, 59],
		]) {
			const result = parse(prefix + date(...values));
			expect(result.departureDateTime).toMatchObject({
				year: values[0],
				month: values[1],
				day: values[2],
				hour: values[3],
				minute: values[4],
				calendarValid: true,
			});
		}
		for (const [index, minimum, maximum] of [
			[0, 2096, 2123],
			[1, 13, 16],
			[2, 32, 32],
			[3, 24, 31],
			[4, 60, 63],
		]) {
			for (let value = minimum; value <= maximum; value++) {
				const values = [2024, 1, 1, 0, 0];
				values[index] = value;
				expect(() => parse(prefix + date(...values))).toThrow();
			}
		}
	});
	it('checks every message family at each truncated byte boundary', () => {
		for (const [direction, choice, body] of [
			['downlink', 0, logon(63)],
			['downlink', 1, '1'],
			['downlink', 2, '00000'],
			['uplink', 0, '11' + applications(1, true) + applications(1, false)],
			['uplink', 1, '10' + applications(1, true)],
			['uplink', 2, text('ATSU', 3, 4) + long()],
			['uplink', 3, logon(63)],
			['uplink', 4, '00000'],
			['uplink', 5, '00'],
		]) {
			const binary = root(direction, choice, body);
			expect(parse(binary, direction).structureComplete).toBe(true);
			for (let count = 0; count < bytes(binary).length; count++)
				expect(() => decodeAtnCm(bytes(binary).slice(0, count), direction)).toThrow();
		}
	});
});
