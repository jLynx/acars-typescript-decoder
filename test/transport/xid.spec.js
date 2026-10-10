import { describe, expect, it } from 'vitest';
import { decodeAvlc, decodeXid } from '@/index';

const bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
const xid = (tlvs) => Uint8Array.from([0x82, 0xf0, tlvs.length >>> 8, tlvs.length & 255, ...tlvs]);
const value = (result, id) =>
	result.groups.find((group) => group.id === 0xf0)?.parameters.find((p) => p.id === id)?.value;

describe('VDL2 XID parameters', () => {
	it.each([
		[
			'94049CA2101040AFBF828000140109383838353A3139393302020001030320A480F000180001560101010301050401258304474D4D5784041A70042549C5',
			'GMMW',
			42.3,
			0.4,
			37000,
		],
		[
			'1462545250088069BF828000140109383838353A3139393302020001030320A480F0001800015601010103010204012583044C46504F84041C100B1CC7B1',
			'LFPO',
			44.9,
			1.1,
			28000,
		],
	])('ports the pinned Rust aircraft-location assertions for %s', (hex, airport, latitude, longitude, altitude) => {
		const frame = decodeAvlc(bytes(hex));
		expect(frame.integrity).toBe('verified');
		expect(value(frame.payload.xid, 0x83)).toBe(airport);
		expect(value(frame.payload.xid, 0x84)).toEqual({ latitude, longitude, altitude, altitudeUnit: 'ft' });
	});
	it('uses C/R, P/F and connection management bits, and supports a private-only group', () => {
		expect(decodeXid(xid([])).type).toBe('GSIF');
		expect(decodeXid(xid([1, 1, 0]), false, true).type).toBe('LE');
		expect(decodeXid(xid([1, 1, 0]), true, true).type).toBe('LE response');
	});
	it('decodes signed location, frequency channel rounding and ground addresses', () => {
		// -36.9, +174.8 in signed 12-bit tenths; channel 3697 => 136.975 MHz.
		const result = decodeXid(xid([0xc8, 3, 0xe8, 0xf6, 0xd4, 0xc0, 6, 0x2e, 0x71, 0, 0, 0, 9]));
		expect(value(result, 0xc8)).toEqual({ latitude: -36.9, longitude: 174.8 });
		expect(value(result, 0xc0)[0]).toMatchObject({ frequency: 136.975, unit: 'MHz', modulation: 2 });
	});
	it('retains unknown and malformed parameter values as partial data', () => {
		const result = decodeXid(xid([0xfe, 2, 1, 2, 0x84, 3, 1, 2, 3]));
		expect(result.coverage).toBe('partial');
		expect(result.groups[0].parameters[0].raw).toEqual(Uint8Array.of(1, 2));
		expect(value(result, 0x84)).toBeUndefined();
	});
	it('rejects truncated groups/TLVs, trailing bytes and duplicate parameters', () => {
		for (const data of [[], [0x82, 0xf0, 0, 2, 1], [...xid([]), 1], [...xid([1, 1, 0, 1, 1, 1])], [...xid([1])]])
			expect(decodeXid(Uint8Array.from(data))).toBeUndefined();
		const data = xid([1, 1, 0]);
		const result = decodeXid(data);
		data[6] = 3;
		expect(result.raw[6]).toBe(0);
	});
});
