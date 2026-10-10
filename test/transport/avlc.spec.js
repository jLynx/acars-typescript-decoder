import { describe, expect, it } from 'vitest';
import { decodeAvlc, avlcCrc, decodeTransportAcars } from '@/transport/avlc';
import { payload, wireBytes } from '../framing/fixtures';

// Independent MSB polynomial division for X-25 (reflect input/output).
const reverse = (value, width) =>
	Array.from({ length: width }, (_, bit) => (value >>> bit) & 1).reduce((sum, bit) => sum * 2 + bit, 0);
const fcs = (bytes) => {
	let crc = 0xffff;
	for (const byte of bytes) {
		crc ^= reverse(byte, 8) << 8;
		for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 65535;
	}
	const value = reverse(crc, 16) ^ 65535;
	return [value & 255, value >>> 8];
};
const address = (id, type, status = 0) => {
	const raw = reverse(id + type * 2 ** 24 + status * 2 ** 27, 28);
	return Array.from({ length: 4 }, (_, index) => ((raw >>> (index * 7)) & 127) * 2 + Number(index === 3));
};
const frame = (control = 0, data = [], sourceType = 1) => {
	const bytes = [...address(0x123456, 4), ...address(0xc0ffee, sourceType), control, ...data];
	bytes[3] &= 254;
	return Uint8Array.from([...bytes, ...fcs(bytes)]);
};

describe('VDL2 AVLC frames', () => {
	it('matches the published CRC-16/X-25 check and full frame residual', () => {
		expect(avlcCrc(new TextEncoder().encode('123456789')) ^ 65535).toBe(0x906e);
		expect(avlcCrc(frame())).toBe(0xf0b8);
	});
	it('reads link addresses, status, and I-frame sequence fields', () => {
		const result = decodeAvlc(frame(0xb6, [0x10, 0, 0]));
		expect(result).toMatchObject({
			integrity: 'verified',
			destination: { address: 0x123456, kind: 'ground' },
			source: { address: 0xc0ffee, kind: 'aircraft' },
			control: { type: 'I', sendSequence: 3, receiveSequence: 5, pollFinal: true },
			payload: { kind: 'x25' },
		});
	});
	it('reads S/U controls and preserves unsupported XID payload bytes', () => {
		expect(decodeAvlc(frame(0x65)).control).toMatchObject({ type: 'S', function: 'RNR', receiveSequence: 3 });
		expect(decodeAvlc(frame(0xbf, [1, 2, 3])).payload).toMatchObject({ kind: 'xid', bytes: Uint8Array.of(1, 2, 3) });
	});
	it('verifies inner ACARS BCS/parity before extracting a report', () => {
		const acars = wireBytes(payload('HELLO')).slice(3);
		expect(decodeAvlc(frame(0, [255, 255, 1, ...acars])).payload.acars).toMatchObject({
			label: 'H1',
			direction: 'downlink',
			text: 'HELLO',
		});
		acars[15] ^= 1;
		expect(decodeAvlc(frame(0, [255, 255, 1, ...acars])).payload.kind).toBe('unknown');
	});
	it('ports the pinned Rust ACARS wire fixture and original metadata assertions', () => {
		const bytes = Uint8Array.from(
			'32 ae d3 d0 ad 4c c4 45 15 32 b3 b3 02 cd b0 b9 c1 4c 4f b0 32 c4 cd 4f ce ce b0 31 4c 4f b0 32 c4 cd 2f 2a 2a 32 b9 32 b0 34 31 45 4c 4c 58 45 d0 57 c1 32 b0 34 31 b0 b0 32 38 83 df cb 7f'.split(
				' ',
			),
			(part) => parseInt(part, 16),
		);
		expect(decodeTransportAcars(bytes)).toMatchObject({
			label: '23',
			blockId: '3',
			flight: 'LO02DM',
			messageNumber: 'M09A',
		});
		expect(decodeTransportAcars(bytes).text).toMatch(/^ONN01LO02DM/);
	});
	it('withholds application bytes on FCS failure and preserves unknown address types', () => {
		const bytes = frame(0, [1, 2, 3]);
		bytes[9] ^= 1;
		expect(decodeAvlc(bytes).integrity).toBe('failed');
		expect(decodeAvlc(bytes).payload).toBeUndefined();
		expect(decodeAvlc(frame(0, [1], 0)).source.kind).toBe('unknown');
	});
	it('rejects malformed lengths and address extension bits', () => {
		expect(() => decodeAvlc(new Uint8Array(10))).toThrow();
		expect(() => decodeAvlc(new Uint8Array(8193))).toThrow();
		const bytes = frame();
		bytes[0] |= 1;
		expect(() => decodeAvlc(bytes)).toThrow(/extension/);
	});
});
