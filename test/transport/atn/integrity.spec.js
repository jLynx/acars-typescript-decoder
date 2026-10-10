import { describe, expect, it } from 'vitest';
import { decodeCotp, createCotpSession, createCotpReassembler } from '@/framing';
import { tpdu, connect, establish, receive } from '../cotp-session/wire';
const addresses = { source: Uint8Array.of(0x47, 1, 2, 3), destination: Uint8Array.of(0x47, 9, 8, 7) };
const mod = (n) => ((n % 255) + 255) % 255;
const choose = (n, k) => {
	let v = 1;
	for (let i = 1; i <= k; i++) v = (v * (n - i + 1)) / i;
	return v;
};
// Independent closed-form cumulative weights and modular linear solver; no iterative runtime checksum used.
function protect(wire, width, offset, isoOffset, nsaps = addresses) {
	const bytes = wire.slice();
	bytes.fill(0, offset, offset + width);
	if (isoOffset !== undefined) bytes.fill(0, isoOffset, isoOffset + 2);
	const input = [...bytes, nsaps.destination.length, ...nsaps.destination, nsaps.source.length, ...nsaps.source];
	const matrix = Array.from({ length: width }, (_, order) => [
		...Array.from({ length: width }, (_, i) => choose(width - i + order - 1, order)),
		mod(-input.reduce((sum, byte, i) => sum + byte * choose(input.length - i + width + order - 1, order), 0)),
	]);
	for (let column = 0; column < width; column++) {
		const row = matrix[column];
		const inverse = Array.from({ length: 254 }, (_, i) => i + 1).find((n) => mod(row[column] * n) === 1);
		if (!inverse) throw Error('Noninvertible fixture matrix');
		for (let j = column; j <= width; j++) row[j] = mod(row[j] * inverse);
		for (let i = 0; i < width; i++)
			if (i !== column) {
				const factor = matrix[i][column];
				for (let j = column; j <= width; j++) matrix[i][j] = mod(matrix[i][j] - factor * row[j]);
			}
	}
	bytes.set(
		matrix.map((row) => row[width]),
		offset,
	);
	if (isoOffset !== undefined) {
		const sum = bytes.reduce((v, b) => v + b, 0),
			weighted = bytes.reduce((v, b, i) => v + b * (bytes.length - i), 0);
		bytes[isoOffset] = mod((bytes.length - isoOffset - 1) * sum - weighted);
		bytes[isoOffset + 1] = mod(-sum - bytes[isoOffset]);
	}
	return bytes;
}
const wire = (width = 4, fixed = [0xf0, 0, 22, 128], payload = [9], iso = false) => {
	const packet = tpdu(fixed, [[width === 4 ? 8 : 9, new Array(width).fill(0)]], payload, iso);
	return protect(packet, width, fixed.length + 3, iso ? fixed.length + width + 5 : undefined);
};
describe('address-bound ATN extended COTP integrity', () => {
	it.each([2, 4])(
		'verifies %i-octet checksum, detects payload/address errors, and retains missing context',
		(width) => {
			const bytes = wire(width);
			const before = bytes.slice();
			expect(decodeCotp(bytes, { format: 'normal', atnAddresses: addresses }).pdus[0].atnIntegrity).toBe('verified');
			expect(decodeCotp(bytes, { format: 'normal' }).pdus[0].atnIntegrity).toBe('unverified');
			const bad = bytes.slice();
			bad[bad.length - 1] ^= 1;
			expect(decodeCotp(bad, { format: 'normal', atnAddresses: addresses }).pdus[0].atnIntegrity).toBe('failed');
			expect(
				decodeCotp(bytes, {
					format: 'normal',
					atnAddresses: { source: addresses.destination, destination: addresses.source },
				}).pdus[0].atnIntegrity,
			).toBe('failed');
			expect(bytes).toEqual(before);
		},
	);
	it.each([2, 4])('zeros the effective ISO checksum during ATN verification, width=%i', (width) => {
		const bytes = wire(width, [0xe3, 0, 0, 0, 11, 0x40], [], true);
		const decoded = decodeCotp(bytes, { atnAddresses: addresses });
		expect(decoded.integrity).toBe('verified');
		expect(decoded.pdus[0].atnIntegrity).toBe('verified');
	});
	it('isolates concatenated ACK checksums by TPDU and validates both', () => {
		const a = wire(4, [0x63, 0, 22, 0], []),
			b = wire(2, [0x63, 0, 22, 1], []);
		expect(
			decodeCotp(Uint8Array.from([...a, ...b]), { format: 'normal', atnAddresses: addresses }).pdus.map(
				(p) => p.atnIntegrity,
			),
		).toEqual(['verified', 'verified']);
	});
	it('rejects malformed/multiple schemes and validates address bounds', () => {
		for (const parts of [
			[[8, [1, 2]]],
			[[9, [1, 2, 3, 4]]],
			[
				[8, [0, 0, 0, 0]],
				[9, [0, 0]],
			],
		])
			expect(
				decodeCotp(tpdu([0xf0, 0, 22, 128], parts, [1], false), { format: 'normal', atnAddresses: addresses }).pdus[0]
					.atnIntegrity,
			).toBe('failed');
		expect(() =>
			decodeCotp(wire(), {
				format: 'normal',
				atnAddresses: { source: new Uint8Array(), destination: addresses.destination },
			}),
		).toThrow();
	});
	it('withholds session data when ATN checksum fails even if ISO checksum passes', () => {
		const e = createCotpSession();
		establish(e);
		const bad = tpdu([0xf0, 0, 22, 128], [[8, [1, 2, 3, 4]]], [1]);
		const result = e.push(bad, { ...receive(1), atnAddresses: addresses });
		expect(result.events.at(-1).status).toBe('failed');
		expect(result.assemblies).toEqual([]);
		const unprotected = connect();
		expect(e.push(unprotected, receive(2)).packet.pdus[0].atnIntegrity).toBeUndefined();
	});
	it.each([2, 4])('retains %i-octet ATN profiles and directed NSAPs and rejects checksum downgrade', (width) => {
		const e = createCotpSession();
		const request = wire(width, [0xe3, 0, 0, 0, 11, 0x40], [], true);
		expect(e.push(request, { ...receive(), atnAddresses: addresses }).events[0].status).toBe('requested');
		const reverse = { source: addresses.destination, destination: addresses.source };
		const cc = tpdu([0xd3, 0, 11, 0, 22, 0x40], [[width === 4 ? 8 : 9, new Array(width).fill(0)]]);
		const confirmation = protect(cc, width, 9, width + 11, reverse);
		expect(e.push(confirmation, receive(1, 'b-to-a')).events[0]).toMatchObject({
			status: 'established',
			negotiation: { atnChecksum: width * 8 },
		});
		expect(e.push(wire(width, [0xf0, 0, 22, 128], [3], true), receive(2)).assemblies[0].status).toBe('complete');
		expect(e.push(tpdu([0xf0, 0, 22, 129], [], [4]), receive(3)).events[0].status).toBe('failed');
		const other = { source: Uint8Array.of(1), destination: Uint8Array.of(2) };
		expect(
			e.push(wire(width, [0xf0, 0, 22, 129], [4], true), { ...receive(4), atnAddresses: other }).events[0].status,
		).toBe('failed');
	});
	it('requires caller-established ATN profiles in explicit assembly and rejects missing/failed checksums', () => {
		const e = createCotpReassembler();
		e.open({ link: 'a', destinationReference: 22, format: 'normal', atnChecksum: 32, atnAddresses: addresses }, 0);
		const received = { link: 'a', receivedAt: 0 };
		expect(e.push(wire(4, [0xf0, 0, 22, 128], [1], true), received).assemblies[0].status).toBe('complete');
		expect(e.push(tpdu([0xf0, 0, 22, 129], [], [2]), received).assemblies[0].status).toBe('failed');
		expect(e.push(tpdu([0xf0, 0, 22, 129], [[8, [0, 0, 0, 0]]], [2]), received).assemblies[0].status).toBe('failed');
		expect(() => e.open({ link: 'a', destinationReference: 22, format: 'normal', atnChecksum: 16 }, 0)).toThrow();
	});
	it('compares verified CR retransmissions by checksum scheme and semantic parameters', () => {
		const e = createCotpSession();
		const first = tpdu(
			[0xe3, 0, 0, 0, 11, 0x40],
			[
				[8, [0, 0, 0, 0]],
				[0xc0, [7]],
			],
		);
		const reordered = tpdu(
			[0xe3, 0, 0, 0, 11, 0x40],
			[
				[0xc0, [7]],
				[8, [0, 0, 0, 0]],
			],
		);
		expect(e.push(protect(first, 4, 9, 18), { ...receive(), atnAddresses: addresses }).events[0].status).toBe(
			'requested',
		);
		expect(e.push(protect(reordered, 4, 12, 18), { ...receive(1), atnAddresses: addresses }).events[0].status).toBe(
			'duplicate',
		);
		const other = { source: Uint8Array.of(1), destination: Uint8Array.of(2) };
		expect(e.push(protect(first, 4, 9, 18, other), { ...receive(2), atnAddresses: other }).events[0].status).toBe(
			'failed',
		);
		expect(e.push(connect(), receive(3)).events[0].status).toBe('failed');
		expect(e.stats()).toEqual({ pending: 1, established: 0, frozen: 0, bytes: 0 });
	});
});
