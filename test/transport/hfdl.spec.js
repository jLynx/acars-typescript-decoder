import { describe, expect, it } from 'vitest';
import { decodeHfdl } from '@/index';
import { payload, wireBytes } from '../framing/fixtures';

// Independent MSB polynomial division with reflection, not the runtime CRC routine.
const reverse = (value, width) =>
	Array.from({ length: width }, (_, bit) => (value >>> bit) & 1).reduce((sum, bit) => sum * 2 + bit, 0);
const frame = (input) => {
	let crc = 65535;
	for (const byte of input) {
		crc ^= reverse(byte, 8) << 8;
		for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 65535;
	}
	const fcs = reverse(crc, 16) ^ 65535;
	return Uint8Array.from([...input, fcs & 255, fcs >>> 8]);
};
const downlink = (lpdus) =>
	Uint8Array.from([
		...frame([3 + lpdus.length * 4, 5, 42, 0, 0, 0, ...lpdus.map((lpdu) => lpdu.length - 1)]),
		...lpdus.flatMap((lpdu) => [...lpdu]),
	]);
const report = (type = 0xd1) => {
	const data = new Uint8Array(type === 0xd1 ? 47 : 21);
	data.set([255, type, ...new TextEncoder().encode('TEST01')]);
	// Independent quantization for signed 20-bit coordinates, little-endian packed.
	const coordinate = (angle) => Math.round((angle * 0x7ffff) / 180) & 0xfffff;
	const lat = coordinate(-36.9),
		lon = coordinate(174.8);
	data.set([lat & 255, (lat >>> 8) & 255, (lat >>> 16) | ((lon & 15) << 4), (lon >>> 4) & 255, lon >>> 12], 8);
	data.set([0x54, 0x54], 13); // 43176 seconds after UTC midnight.
	return data;
};
const inner = (result) => result.mpdu.aircraft[0].lpdus[0];

describe('HFDL already-demodulated PDU decoding', () => {
	it('decodes CRC-verified SPDU station masks, TDMA values and retained slot data', () => {
		const data = new Uint8Array(64);
		data.set([0xaa, 0x85, 0x34, 0xa2]);
		data.set([3, 0x45, 0x31, 2, 1, 0x86, 0x67, 0x45, 0x32, 0x29, 3, 4], 52);
		const result = decodeHfdl(frame(data));
		expect(result).toMatchObject({
			type: 'SPDU',
			integrity: 'verified',
			spdu: {
				groundStation: 5,
				version: 2,
				rlsInUse: true,
				iso8208Supported: true,
				change: 2,
				tdmaFrameIndex: 0x234,
				tdmaFrameOffset: 10,
				minimumPriority: 3,
				systemTableVersion: 0x145,
				stations: [
					{ id: 5, frequenciesInUseMask: 0x1023 },
					{ id: 6, frequenciesInUseMask: 0x24567 },
					{ id: 19, frequenciesInUseMask: 0x4032 },
				],
			},
		});
		expect(result.spdu.slotsRaw).toHaveLength(48);
	});
	it('decodes downlink logon metadata with separate header and LPDU integrity', () => {
		const result = decodeHfdl(downlink([frame([0x9f, 0xab, 0xcd, 0xef, 42])]));
		expect(result).toMatchObject({
			integrity: 'verified',
			mpdu: {
				direction: 'downlink',
				groundStation: 5,
				aircraft: [
					{
						id: 42,
						lpdus: [{ integrity: 'verified', typeName: 'Logon confirm', icaoAddress: 0xabcdef, aircraftId: 42 }],
					},
				],
			},
		});
	});
	it('reads multiple uplink aircraft and verifies each LPDU', () => {
		const first = frame([0x4f, 1, 2, 3]),
			second = frame([0x2f, 4, 5, 6, 7]);
		const data = Uint8Array.from([
			...frame([0x11, 5, 40, 0x10, first.length - 1, 41, 0x10, second.length - 1]),
			...first,
			...second,
		]);
		const result = decodeHfdl(data);
		expect(result.mpdu.direction).toBe('uplink');
		expect(result.mpdu.aircraft.map((aircraft) => aircraft.id)).toEqual([40, 41]);
		expect(result.mpdu.aircraft[1].lpdus[0].reason).toBe(7);
	});
	it('withholds fields after failed header/LPDU checksums and distinguishes truncated data', () => {
		const good = downlink([frame([0x9f, 1, 2, 3, 42])]);
		const badHeader = good.slice();
		badHeader[2] ^= 1;
		expect(decodeHfdl(badHeader).mpdu).toBeUndefined();
		const badBody = good.slice();
		badBody[10] ^= 1;
		expect(inner(decodeHfdl(badBody))).toMatchObject({ integrity: 'failed' });
		expect(inner(decodeHfdl(badBody)).icaoAddress).toBeUndefined();
		expect(inner(decodeHfdl(good.slice(0, -1))).integrity).toBe('incomplete');
	});
	it('verifies encapsulated ACARS BCS and parity before exposing a message', () => {
		const acars = wireBytes(payload('HELLO')).slice(3);
		const good = decodeHfdl(downlink([frame([0x0d, 255, 255, ...acars])]));
		expect(inner(good).hfnpdu.acars).toMatchObject({ label: 'H1', text: 'HELLO', direction: 'downlink' });
		acars[15] ^= 1;
		expect(inner(decodeHfdl(downlink([frame([0x0d, 255, 255, ...acars])]))).hfnpdu.acars).toBeUndefined();
	});
	it('reads named performance fields, counts and scales without inferring a date', () => {
		const data = report();
		data.set([1, 2, 5, 4, 3, 0, 4, 0, 5, 0, 6, 0, 1, 2, 3, 4], 15);
		data[46] = 7;
		const result = inner(decodeHfdl(downlink([frame([0x0d, ...data])]))).hfnpdu.report;
		expect(result).toMatchObject({
			flight: 'TEST01',
			time: 43176,
			timeUnit: 's',
			performance: {
				version: 1,
				flightLeg: 2,
				groundStation: 5,
				frequencyId: 4,
				frequencySearches: { previousLeg: 3, currentLeg: 4 },
				hfDisabled: { previousLeg: 5, currentLeg: 6, unit: 's' },
				mpdusReceived: { 300: 4, 600: 3, 1200: 2, 1800: 1 },
				frequencyChangeName: 'No change',
			},
		});
		expect(result.position.latitude).toBeCloseTo(-36.9, 3);
		expect(result.position.longitude).toBeCloseTo(174.8, 3);
	});
	it('reads system-table fragment headers and frequency masks', () => {
		expect(inner(decodeHfdl(downlink([frame([0x0d, 255, 0xd0, 0x21, 0x30, 2])]))).hfnpdu.systemTable).toEqual({
			total: 3,
			sequence: 1,
			version: 35,
		});
		const data = report(0xd5);
		data.set([5, 1, 2, 0x43, 5, 6], 15);
		expect(inner(decodeHfdl(downlink([frame([0x0d, ...data])]))).hfnpdu.report.frequencies).toEqual([
			{ groundStation: 5, propagatingMask: 0x30201, heardMask: 0x6054 },
		]);
	});
	it('rejects invalid report clocks and lengths, and bounds PDU sizes', () => {
		const data = report();
		data.set([255, 255], 13);
		expect(inner(decodeHfdl(downlink([frame([0x0d, ...data])]))).hfnpdu.report).toBeUndefined();
		for (const input of [new Uint8Array(), new Uint8Array(8193), Uint8Array.of(0), Uint8Array.of(1)])
			expect(() => decodeHfdl(input)).toThrow();
	});
});
