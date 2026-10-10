import { describe, expect, it } from 'vitest';
import { decodeCotp, createClnpReassembler } from '@/index';

// Brute-force solution of RFC 905 §6.17 equations, independent of the production running-sum algorithm.
function checksum(bytes, offset) {
	bytes[offset] = bytes[offset + 1] = 0;
	const sum = bytes.reduce((total, byte) => total + byte, 0) % 255;
	const weighted = bytes.reduce((total, byte, index) => total + (index + 1) * byte, 0) % 255;
	for (let x = 0; x < 255; x++) {
		const y = (-sum - x + 510) % 255;
		if ((weighted + (offset + 1) * x + (offset + 2) * y) % 255 === 0) {
			bytes[offset] = x;
			bytes[offset + 1] = y;
			return bytes;
		}
	}
	throw new Error('Checksum equations have no solution');
}
const data = (payload = [1, 2, 3]) =>
	checksum(Uint8Array.from([8, 0xf0, 0x12, 0x34, 0x80, 0xc3, 2, 0, 0, ...payload]), 7);
const ack = () => checksum(Uint8Array.of(8, 0x60, 0x12, 0x34, 1, 0xc3, 2, 0, 0), 7);

describe('COTP ISO 8073 full-TPDU checksum', () => {
	it('verifies checksum including length indicator, header and user data', () => {
		const result = decodeCotp(data());
		expect(result).toMatchObject({
			integrity: 'verified',
			pdus: [{ integrity: 'verified', userData: Uint8Array.of(1, 2, 3) }],
		});
		for (const offset of [2, 4, 7, 9]) {
			const wire = data();
			wire[offset] ^= 1;
			expect(decodeCotp(wire)).toMatchObject({ integrity: 'failed', pdus: [{ integrity: 'failed' }] });
		}
	});
	it('keeps corrupt user bytes available as raw data with failed integrity', () => {
		const wire = data();
		wire[10] = 99;
		expect(decodeCotp(wire).pdus[0].userData).toEqual(Uint8Array.of(1, 99, 3));
	});
	it('verifies concatenated TPDUs independently and includes only the last data TPDU payload', () => {
		const wire = Uint8Array.from([...ack(), ...data()]);
		expect(decodeCotp(wire)).toMatchObject({
			integrity: 'verified',
			pdus: [{ integrity: 'verified' }, { integrity: 'verified' }],
		});
		wire[2] ^= 1;
		expect(decodeCotp(wire)).toMatchObject({
			integrity: 'failed',
			pdus: [{ integrity: 'failed' }, { integrity: 'verified' }],
		});
	});
	it('requires all parsed TPDUs to verify before reporting aggregate verification', () => {
		const unverified = Uint8Array.of(4, 0x60, 0, 1, 0);
		expect(decodeCotp(Uint8Array.from([...ack(), ...unverified]))).toMatchObject({
			integrity: 'unverified',
			pdus: [{ integrity: 'verified' }, { integrity: 'unverified' }],
		});
		expect(decodeCotp(Uint8Array.from([...ack(), 255]))).toMatchObject({
			integrity: 'unverified',
			unconsumed: Uint8Array.of(255),
		});
	});
	it('checks presence and exact two-byte size without applying CLNP omitted-checksum rules', () => {
		expect(decodeCotp(Uint8Array.of(4, 0xf0, 0, 1, 0x80)).integrity).toBe('unverified');
		expect(decodeCotp(Uint8Array.of(7, 0xf0, 0, 1, 0x80, 0xc3, 1, 0), { format: 'normal' }).integrity).toBe('failed');
		const wire = data();
		wire[7] = wire[8] = 0;
		expect(decodeCotp(wire).integrity).toBe('failed');
		// ISO 8073 allows zero checksum octets when they satisfy the equations.
		const zero = Array.from({ length: 255 }, (_, value) => data([2, value])).find((bytes) => bytes[7] === 0);
		expect(zero[7]).toBe(0);
		expect(decodeCotp(zero).integrity).toBe('verified');
	});
	it('keeps the ATN checksum parameter unverified', () => {
		expect(decodeCotp(Uint8Array.of(8, 0xf0, 0, 1, 0x80, 8, 2, 1, 2)).integrity).toBe('unverified');
	});
	it('verifies connect-request and extended sequence headers with parameters in different positions', () => {
		const cr = checksum(Uint8Array.of(13, 0xe0, 0, 0, 0, 1, 0x40, 0xc0, 1, 10, 0xc3, 2, 0, 0), 12);
		expect(decodeCotp(cr)).toMatchObject({ integrity: 'verified', pdus: [{ protocolClass: 4 }] });
		const extended = checksum(Uint8Array.of(11, 0xf0, 0, 1, 0x80, 0, 0, 5, 0xc3, 2, 0, 0, 9), 10);
		expect(decodeCotp(extended, { format: 'extended' })).toMatchObject({
			integrity: 'verified',
			pdus: [{ sendSequence: 5 }],
		});
	});
	it('verifies complete transport bytes after independent CLNP segmentation/header checks', () => {
		const tpdu = data(Array.from({ length: 15 }, (_, index) => index));
		function fragment(start, end) {
			const length = 21 + end - start;
			const wire = Uint8Array.from([
				0x81,
				21,
				1,
				20,
				28 | 128 | (end < tpdu.length ? 64 : 0),
				0,
				length,
				0,
				0,
				1,
				0x47,
				3,
				0x47,
				1,
				2,
				0,
				1,
				0,
				start,
				0,
				21 + tpdu.length,
				...tpdu.slice(start, end),
			]);
			// Header addresses: destination [47], source [47,1,2]. Segmentation begins at byte 15.
			checksum(wire.subarray(0, 21), 7);
			if (!wire[7]) wire[7] = 255;
			if (!wire[8]) wire[8] = 255;
			return wire;
		}
		const session = createClnpReassembler();
		expect(session.push(fragment(0, 16), { link: 'test', receivedAt: 0 }).status).toBe('pending');
		const result = session.push(fragment(16, 24), { link: 'test', receivedAt: 1 });
		expect(result.cotp.integrity).toBe('verified');
		const corrupted = fragment(16, 24);
		corrupted[22] ^= 1;
		const other = createClnpReassembler();
		other.push(fragment(0, 16), { link: 'test', receivedAt: 0 });
		const failed = other.push(corrupted, { link: 'test', receivedAt: 1 });
		expect(failed).toMatchObject({
			status: 'complete',
			packet: { integrity: 'verified' },
			cotp: { integrity: 'failed' },
		});
	});
});
