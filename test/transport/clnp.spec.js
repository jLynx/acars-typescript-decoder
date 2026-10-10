import { describe, expect, it } from 'vitest';
import { decodeClnp, decodeEsis, decodeX25, createX25Reassembler } from '@/index';

// RFC 994 §6.11 weighted-sum equations solved directly, independent of the running-sum verifier.
function checksum(header) {
	header[7] = header[8] = 0;
	const sum = header.reduce((total, byte) => total + byte, 0) % 255;
	const weighted = header.reduce((total, byte, index) => total + (header.length - index) * byte, 0) % 255;
	const x = ((header.length - 8) * sum - weighted + 255 * 256) % 255;
	header[7] = x || 255;
	header[8] = (-sum - x + 510) % 255 || 255;
	return header;
}

function packet(
	payload = [4, 0xf0, 0x12, 0x34, 0x80, 9],
	{ more = false, offset = 0, segmented = false, total, options = [], type = 28 } = {},
) {
	const addresses = [2, 0x47, 1, 2, 0x47, 2];
	const length = 9 + addresses.length + (segmented ? 6 : 0) + options.length;
	const totalLength = total ?? length + payload.length;
	const segmentation = segmented ? [0x12, 0x34, offset >> 8, offset & 255, totalLength >> 8, totalLength & 255] : [];
	const header = checksum(
		Uint8Array.from([
			0x81,
			length,
			1,
			11,
			type | (segmented ? 128 : 0) | (more ? 64 : 0),
			(length + payload.length) >> 8,
			(length + payload.length) & 255,
			0,
			0,
			...addresses,
			...segmentation,
			...options,
		]),
	);
	return Uint8Array.from([...header, ...payload]);
}

describe('uncompressed CLNP from RFC 994', () => {
	it('verifies header checksum, addresses, lifetime and bounded raw transport data', () => {
		const wire = packet();
		const result = decodeClnp(wire);
		expect(result).toMatchObject({
			type: 'Data',
			integrity: 'verified',
			lifetime: 5.5,
			lifetimeUnit: 's',
			destination: Uint8Array.of(0x47, 1),
			source: Uint8Array.of(0x47, 2),
			cotp: { integrity: 'unverified', pdus: [{ destinationReference: 0x1234, userData: Uint8Array.of(9) }] },
		});
		wire[10] = 99;
		expect(result.destination).toEqual(Uint8Array.of(0x47, 1));
	});
	it('withholds inner data on failed or omitted checksums', () => {
		const wire = packet();
		wire[3] ^= 1;
		expect(decodeClnp(wire)).toMatchObject({ integrity: 'failed' });
		expect(decodeClnp(wire).payload).toBeUndefined();
		wire[7] = wire[8] = 0;
		const omitted = decodeClnp(wire);
		expect(omitted.integrity).toBe('unverified');
		expect(omitted.payload).toHaveLength(6);
		expect(omitted.cotp).toBeUndefined();
		wire[8] = 1;
		expect(decodeClnp(wire).integrity).toBe('failed');
	});
	it('retains options including unknown values without inventing semantics', () => {
		const result = decodeClnp(packet([], { options: [0xcd, 1, 14, 0x77, 2, 1, 2] }));
		expect(result.options).toMatchObject([
			{ name: 'Priority', value: 14 },
			{ name: 'Unknown', raw: Uint8Array.of(1, 2) },
		]);
		expect(decodeClnp(packet([], { options: [0xcd, 1, 15] })).options[0].value).toBeUndefined();
		expect(decodeClnp(packet([], { options: [0xcd, 2, 1] }))).toBeUndefined();
		expect(decodeClnp(packet([], { options: [0xcd, 1, 1, 0xcd, 1, 2] }))).toBeUndefined();
	});
	it('retains segmentation fields without decoding incomplete inner TPDUs', () => {
		const first = decodeClnp(packet([4, 0xf0, 0, 1, 0x80, 2, 3, 4], { segmented: true, more: true, total: 33 }));
		expect(first).toMatchObject({ pduId: 0x1234, offset: 0, totalLength: 33, more: true });
		expect(first.cotp).toBeUndefined();
		const final = decodeClnp(packet([5, 6, 7, 8], { segmented: true, offset: 8, total: 33 }));
		expect(final.payload).toEqual(Uint8Array.of(5, 6, 7, 8));
		expect(final.cotp).toBeUndefined();
	});
	it.each([
		{ segmented: true, offset: 1 },
		{ segmented: true, total: 20 },
		{ segmented: true, more: true, total: 50 },
		{ segmented: true, offset: 8, total: 50 },
		{ more: true },
		{ segmented: true, type: 1 },
	])('rejects impossible segmentation %j', (options) => expect(decodeClnp(packet(undefined, options))).toBeUndefined());
	it('rejects truncation, invalid versions, lengths, address boundaries and unsupported types', () => {
		const wire = packet();
		for (let length = 0; length < wire.length; length++) expect(decodeClnp(wire.slice(0, length))).toBeUndefined();
		for (const [offset, value] of [
			[1, 255],
			[2, 2],
			[4, 7],
			[6, 0],
			[9, 21],
			[12, 21],
		]) {
			const malformed = wire.slice();
			malformed[offset] = value;
			checksum(malformed.subarray(0, malformed[1] === 255 ? 15 : malformed[1]));
			expect(decodeClnp(malformed)).toBeUndefined();
		}
	});
	it('dispatches complete X.25 packets and reassembled user data to uncompressed CLNP', () => {
		const wire = packet();
		expect(decodeX25(Uint8Array.from([0x10, 7, 0, ...wire])).network.integrity).toBe('verified');
		const session = createX25Reassembler();
		session.push(Uint8Array.from([0x10, 7, 0x10, ...wire.slice(0, 10)]), { link: 'a', receivedAt: 0 });
		const result = session.push(Uint8Array.from([0x10, 7, 2, ...wire.slice(10)]), { link: 'a', receivedAt: 1 });
		expect(result.network.cotp.pdus).toHaveLength(1);
	});
	it('retains the discarded PDU in an error report without recursive decoding', () => {
		const result = decodeClnp(packet([1, 2, 3], { type: 1, options: [0xc1, 2, 0x80, 0] }));
		expect(result.type).toBe('Error Report');
		expect(result.payload).toEqual(Uint8Array.of(1, 2, 3));
		expect(result.cotp).toBeUndefined();
	});
});

describe('ES-IS common, ISH and redirect headers', () => {
	const esis = (type, addresses, options = []) =>
		checksum(
			Uint8Array.from([0x82, 9 + addresses.length + options.length, 1, 0, type, 0, 30, 0, 0, ...addresses, ...options]),
		);
	it('reads ISH NET and redirect destination/SNPA/NET with verified checksums', () => {
		expect(decodeEsis(esis(4, [2, 0x47, 1]))).toMatchObject({
			type: 'Intermediate System Hello',
			holdingTime: 30,
			holdingTimeUnit: 's',
			integrity: 'verified',
			networkEntityTitle: Uint8Array.of(0x47, 1),
		});
		const redirect = decodeEsis(esis(6, [2, 0x47, 1, 2, 1, 2, 0]));
		expect(redirect).toMatchObject({
			type: 'Redirect',
			destination: Uint8Array.of(0x47, 1),
			betterSubnetworkAddress: Uint8Array.of(1, 2),
			networkEntityTitle: new Uint8Array(),
		});
	});
	it('preserves ESH address variants as raw and unrecognized options', () => {
		expect(decodeEsis(esis(2, [1, 2, 0x47, 1])).addressesRaw).toEqual(Uint8Array.of(1, 2, 0x47, 1));
		expect(decodeEsis(esis(4, [1, 1], [0xee, 1, 2])).options[0]).toMatchObject({
			name: 'Unknown',
			raw: Uint8Array.of(2),
		});
	});
	it('withholds addresses after checksum failure and rejects malformed layouts', () => {
		const wire = esis(4, [2, 0x47, 1]);
		wire[5] ^= 1;
		expect(decodeEsis(wire)).toMatchObject({ integrity: 'failed' });
		expect(decodeEsis(wire).networkEntityTitle).toBeUndefined();
		for (const invalid of [esis(1, []), esis(4, [3, 1]), esis(6, [1, 1]), esis(4, [0]), esis(4, [1, 1], [0xee, 3, 1])])
			expect(decodeEsis(invalid)).toBeUndefined();
		expect(decodeEsis(esis(4, [1, 1]).slice(0, -1))).toBeUndefined();
	});
	it('dispatches ES-IS from X.25 without treating it as compressed CLNP', () => {
		const wire = esis(4, [2, 0x47, 1]);
		const result = decodeX25(Uint8Array.from([0x10, 7, 0, ...wire]));
		expect(result.esis.integrity).toBe('verified');
		expect(result.clnp).toBeUndefined();
	});
});
