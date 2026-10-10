import { describe, expect, it } from 'vitest';
import { AcarsFramer, acarsCrc, decodeFrame, oddParity } from '@/index';
import { payload, parity, wireBytes } from './fixtures';

const feed = (framer, bytes, invert = 0) => {
	for (const byte of bytes) for (let bit = 0; bit < 8; bit++) framer.bit(((byte >> bit) & 1) ^ invert);
};

describe('ARINC 618 framing', () => {
	it('matches CRC-16/KERMIT and all odd parity byte combinations', () => {
		expect(acarsCrc(new TextEncoder().encode('123456789'))).toBe(0x2189);
		for (let byte = 0; byte < 128; byte++) {
			expect(oddParity(parity(byte))).toBe(true);
			expect(oddParity(parity(byte) ^ 128)).toBe(false);
		}
	});
	it.each([0, 1])('reads complete envelopes with polarity %s', (invert) => {
		const received = [];
		feed(new AcarsFramer((f) => received.push(decodeFrame(f))), wireBytes(), invert);
		expect(received).toMatchObject([
			{
				registration: 'ZK-NZE',
				label: 'H1',
				messageNumber: 'M01A',
				flight: 'ANZ001',
				direction: 'downlink',
				text: 'ARRIVAL GATE 12\r\nETA 1234',
			},
		]);
	});
	it('rejects checksum and parity errors and recovers for the next frame', () => {
		const frames = [];
		const framer = new AcarsFramer((f) => frames.push(f));
		const bad = wireBytes();
		bad[15] ^= 3;
		feed(framer, bad);
		const badParity = payload();
		badParity[15] ^= 128;
		feed(framer, wireBytes(badParity));
		feed(framer, wireBytes());
		expect(frames).toEqual([payload()]);
	});
	it('decodes uplinks, ETB and the DEL acknowledgement label', () => {
		expect(decodeFrame(payload('GROUND MESSAGE', 'A', 0x17))).toMatchObject({
			direction: 'uplink',
			text: 'GROUND MESSAGE',
			continuation: true,
			messageNumber: undefined,
		});
		const ack = Uint8Array.from([...`2.ZK-NZE5_\x7f1\x03`], (c) => parity(c.charCodeAt(0)));
		expect(decodeFrame(ack)).toMatchObject({ label: '_d', acknowledgement: '5', text: '' });
	});
	it('bounds frames and drops incomplete packets on reset', () => {
		const frames = [];
		const framer = new AcarsFramer((f) => frames.push(f));
		const wire = wireBytes();
		feed(framer, wire.subarray(0, 20));
		framer.reset();
		feed(framer, wire.subarray(20));
		feed(framer, wireBytes(payload('X'.repeat(217))));
		expect(frames).toEqual([]);
		feed(framer, wireBytes(payload('X'.repeat(216))));
		expect(frames).toHaveLength(1);
	});
});
