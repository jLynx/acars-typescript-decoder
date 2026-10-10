import { describe, expect, it } from 'vitest';
import { decodeEsis, decodeX25, createX25Reassembler } from '@/index';

// RFC 995 checksum equations independently solved; modern count/list from pinned NetBSD esis_shoutput.
function checksum(bytes) {
	bytes[7] = bytes[8] = 0;
	const sum = bytes.reduce((total, byte) => total + byte, 0) % 255;
	const weighted = bytes.reduce((total, byte, index) => total + (index + 1) * byte, 0) % 255;
	bytes[7] = (weighted - 9 * sum + 255 * 256) % 255 || 255;
	bytes[8] = (-sum - bytes[7] + 510) % 255 || 255;
	return bytes;
}
function wire(type, body) {
	return checksum(Uint8Array.from([0x82, 9 + body.length, 1, 0, type, 0, 30, 0, 0, ...body]));
}
const hello = (addresses, options = []) =>
	wire(2, [addresses.length, ...addresses.flatMap((address) => [address.length, ...address]), ...options]);

describe('ES-IS ESH address lists and ISH configuration timer', () => {
	it('reads multiple source NSAPs in order and retains the complete raw region', () => {
		const bytes = hello(
			[
				[0x47, 1],
				[0x47, 2, 3],
			],
			[0xee, 1, 9],
		);
		const result = decodeEsis(bytes);
		expect(result).toMatchObject({
			integrity: 'verified',
			eshFormat: 'address-list',
			sourceAddresses: [Uint8Array.of(0x47, 1), Uint8Array.of(0x47, 2, 3)],
			options: [{ name: 'Unknown', raw: Uint8Array.of(9) }],
		});
		expect(result.addressesRaw).toEqual(bytes.slice(9));
		bytes.fill(0);
		expect(result.sourceAddresses[0]).toEqual(Uint8Array.of(0x47, 1));
	});
	it('does not deduplicate NSAPs or infer common address components', () => {
		const result = decodeEsis(
			hello([
				[0x47, 1],
				[0x47, 1],
			]),
		);
		expect(result.sourceAddresses).toHaveLength(2);
	});
	it.each([1, 20])('accepts an NSAP of %i bytes', (length) => {
		expect(decodeEsis(hello([new Array(length).fill(1)])).sourceAddresses[0]).toHaveLength(length);
	});
	it('bounds address counts by the wire length and supports the maximum PDU', () => {
		const result = decodeEsis(hello(Array.from({ length: 122 }, () => [1])));
		expect(result.raw).toHaveLength(254);
		expect(result.sourceAddresses).toHaveLength(122);
	});
	it.each(
		[[0], [255, 1, 1], [1], [1, 0], [1, 21, ...new Array(21).fill(1)], [2, 1, 1], [1, 3, 1, 2]].map((body) => ({
			body,
		})),
	)('rejects malformed/truncated counted addresses %j', ({ body }) => {
		expect(decodeEsis(wire(2, body))).toBeUndefined();
	});
	it('rejects incomplete or duplicate options after the exact count of addresses', () => {
		for (const options of [
			[0xee, 3, 1],
			[0xee, 0],
			[0xee, 1, 1, 0xee, 1, 2],
		])
			expect(decodeEsis(hello([[0x47, 1]], options))).toBeUndefined();
	});
	it('supports explicitly selected legacy single-address ESH without guessing', () => {
		const bytes = wire(2, [2, 0x47, 1, 0xcd, 1, 3]);
		expect(decodeEsis(bytes)).toBeUndefined();
		expect(decodeEsis(bytes, { eshFormat: 'legacy-single' })).toMatchObject({
			eshFormat: 'legacy-single',
			sourceAddresses: [Uint8Array.of(0x47, 1)],
			options: [{ name: 'Priority', value: 3 }],
		});
	});
	it('preserves uninterpreted variants in explicitly selected raw mode', () => {
		const result = decodeEsis(wire(2, [255, 1]), { eshFormat: 'raw' });
		expect(result.addressesRaw).toEqual(Uint8Array.of(255, 1));
		expect(result.sourceAddresses).toBeUndefined();
	});
	it('withholds addresses after checksum failure and keeps omitted checksum integrity explicit', () => {
		const bytes = hello([[0x47, 1]]);
		bytes[bytes.length - 1] ^= 1;
		expect(decodeEsis(bytes)).toMatchObject({ integrity: 'failed' });
		expect(decodeEsis(bytes).sourceAddresses).toBeUndefined();
		bytes[7] = bytes[8] = 0;
		expect(decodeEsis(bytes)).toMatchObject({ integrity: 'unverified', sourceAddresses: [Uint8Array.of(0x47, 0)] });
	});
	it.each([0, 30, 65535])('reads the ISH configuration timer %i with explicit seconds', (timer) => {
		const options = decodeEsis(wire(4, [2, 0x47, 1, 0xc6, 2, timer >> 8, timer & 255])).options;
		expect(options).toMatchObject([{ name: 'End system configuration timer', value: timer, unit: 's' }]);
		expect(options[0].decoded).toBeUndefined();
		expect(options[0].reason).toBeUndefined();
	});
	it('requires two bytes for the ISH timer and does not apply it to ESH/redirect', () => {
		expect(decodeEsis(wire(4, [1, 1, 0xc6, 1, 30]))).toBeUndefined();
		expect(decodeEsis(hello([[1]], [0xc6, 2, 0, 30])).options[0]).toMatchObject({ name: 'Unknown' });
		expect(decodeEsis(wire(6, [1, 1, 1, 2, 0, 0xc6, 2, 0, 30])).options[0].value).toBeUndefined();
		for (const packet of [hello([[1]], [0xc6, 2, 0, 30]), wire(6, [1, 1, 1, 2, 0, 0xc6, 2, 0, 30])]) {
			expect(decodeEsis(packet).options[0].decoded).toBeUndefined();
			expect(decodeEsis(packet).options[0].reason).toBeUndefined();
		}
	});
	it('dispatches modern address lists through X.25 packets and M-bit reassembly', () => {
		const bytes = hello([
			[0x47, 1],
			[0x47, 2],
		]);
		expect(decodeX25(Uint8Array.from([0x10, 1, 0, ...bytes])).esis.sourceAddresses).toHaveLength(2);
		const assembler = createX25Reassembler();
		assembler.push(Uint8Array.from([0x10, 1, 0x10, ...bytes.slice(0, 10)]), { link: 'test', receivedAt: 0 });
		expect(
			assembler.push(Uint8Array.from([0x10, 1, 2, ...bytes.slice(10)]), { link: 'test', receivedAt: 1 }).esis
				.sourceAddresses,
		).toHaveLength(2);
	});
});
