import { describe, expect, it } from 'vitest';
import { createCotpReassembler } from '@/index';

// Solve RFC 905 §6.17 modular equations independently of production verification.
function checksum(bytes, offset) {
	bytes[offset] = bytes[offset + 1] = 0;
	const sum = bytes.reduce((total, byte) => total + byte, 0) % 255;
	const weighted = bytes.reduce((total, byte, index) => total + (index + 1) * byte, 0) % 255;
	bytes[offset] = (weighted - (offset + 2) * sum + 255 * 256) % 255;
	bytes[offset + 1] = (-sum - bytes[offset] + 510) % 255;
	return bytes;
}
function data(type, sequence, payload = [sequence & 255], { format = 'normal', end = true, reference = 1 } = {}) {
	const encoded =
		format === 'normal'
			? [sequence | (end ? 128 : 0)]
			: [(sequence >>> 24) | (end ? 128 : 0), (sequence >>> 16) & 255, (sequence >>> 8) & 255, sequence & 255];
	const fixed = [type, reference >> 8, reference & 255, ...encoded];
	return checksum(Uint8Array.from([fixed.length + 4, ...fixed, 0xc3, 2, 0, 0, ...payload]), fixed.length + 3);
}
function release(type, { reference = 1, peer = 2 } = {}) {
	const fixed = [type, reference >> 8, reference & 255, peer >> 8, peer & 255];
	if (type === 0x80) fixed.push(0);
	return checksum(Uint8Array.from([fixed.length + 4, ...fixed, 0xc3, 2, 0, 0]), fixed.length + 3);
}
const receive = (receivedAt = 0, link = 'a') => ({ receivedAt, link });
function session(options = {}, connection = {}) {
	const assembler = createCotpReassembler(options);
	assembler.open(
		{ link: 'a', destinationReference: 1, sourceReference: 2, format: 'normal', expedited: {}, ...connection },
		0,
	);
	return assembler;
}
const output = (result) => result.assemblies[0];

describe('negotiated class-4 COTP expedited service', () => {
	it('uses independent ED and DT sequences and labels the delivered service', () => {
		const assembler = session();
		assembler.push(data(0xf0, 0, [1], { end: false }), receive());
		expect(output(assembler.push(data(0x10, 0, [9]), receive(1)))).toMatchObject({
			status: 'complete',
			service: 'expedited',
			firstSequence: 0,
			lastSequence: 0,
			fragments: 1,
			payload: Uint8Array.of(9),
		});
		expect(output(assembler.push(data(0xf0, 1, [2]), receive(2)))).toMatchObject({
			status: 'complete',
			service: 'normal',
			payload: Uint8Array.of(1, 2),
		});
		expect(output(assembler.push(data(0x10, 1, [8]), receive(3)))).toMatchObject({
			service: 'expedited',
			payload: Uint8Array.of(8),
		});
	});
	it('requires declared expedited negotiation before accepting ED data', () => {
		const assembler = session({}, { expedited: undefined });
		expect(output(assembler.push(data(0x10, 0), receive()))).toMatchObject({ status: 'ignored', service: 'expedited' });
		expect(assembler.stats().bytes).toBe(0);
		expect(output(assembler.push(data(0xf0, 0), receive(1))).status).toBe('complete');
	});
	it('buffers out-of-order EDs as separate messages without combining their data', () => {
		const assembler = session();
		expect(output(assembler.push(data(0x10, 1, [2]), receive())).status).toBe('pending');
		const released = assembler.push(data(0x10, 0, [1]), receive(1)).assemblies;
		expect(released.map((message) => [...message.payload])).toEqual([[1], [2]]);
		expect(released.map((message) => message.fragments)).toEqual([1, 1]);
	});
	it.each(['normal', 'extended'])('handles %s ED sequence wrap independently of DT', (format) => {
		const startSequence = format === 'normal' ? 127 : 2 ** 31 - 1;
		const assembler = session({}, { format, expedited: { startSequence } });
		assembler.push(data(0x10, 0, [2], { format }), receive());
		const released = assembler.push(data(0x10, startSequence, [1], { format }), receive(1)).assemblies;
		expect(released.map((message) => message.firstSequence)).toEqual([startSequence, 0]);
		expect(output(assembler.push(data(0xf0, 0, [3], { format }), receive(2)))).toMatchObject({
			status: 'complete',
			service: 'normal',
		});
	});
	it.each([1, 16])('accepts the %i-byte ED size boundary', (length) => {
		expect(output(session().push(data(0x10, 0, new Uint8Array(length)), receive())).payload).toHaveLength(length);
	});
	it.each([
		[0, true],
		[17, true],
		[1, false],
	])('rejects invalid ED length=%i EOT=%s without changing sequences', (length, end) => {
		const assembler = session();
		expect(output(assembler.push(data(0x10, 0, new Uint8Array(length), { end }), receive())).status).toBe('failed');
		expect(output(assembler.push(data(0x10, 0, [1]), receive(1))).status).toBe('complete');
	});
	it('suppresses both buffered and completed ED retransmissions', () => {
		const assembler = session();
		assembler.push(data(0x10, 1, [2]), receive());
		expect(output(assembler.push(data(0x10, 1, [2]), receive(1))).status).toBe('duplicate');
		assembler.push(data(0x10, 0, [1]), receive(2));
		expect(output(assembler.push(data(0x10, 0, [1]), receive(3))).status).toBe('duplicate');
	});
	it('rejects conflicting ED retransmissions and rejects further normal data on that connection', () => {
		const assembler = session();
		assembler.push(data(0xf0, 0, [1], { end: false }), receive());
		assembler.push(data(0x10, 0, [2]), receive(1));
		expect(output(assembler.push(data(0x10, 0, [3]), receive(2))).status).toBe('failed');
		expect(assembler.stats().bytes).toBe(0);
		expect(output(assembler.push(data(0xf0, 1, [4]), receive(3))).status).toBe('failed');
	});
	it('rejects corrupt ED checksums and still accepts a later valid retransmission', () => {
		const assembler = session();
		const corrupt = data(0x10, 0, [2]);
		corrupt[corrupt.length - 1] ^= 1;
		expect(output(assembler.push(corrupt, receive())).status).toBe('failed');
		expect(output(assembler.push(data(0x10, 0, [2]), receive(1))).payload).toEqual(Uint8Array.of(2));
	});
	it('frees expedited history and gaps after a normal DT conflict', () => {
		const assembler = session();
		assembler.push(data(0x10, 0, [1]), receive());
		assembler.push(data(0x10, 2, [2]), receive(1));
		assembler.push(data(0xf0, 0, [3], { end: false }), receive(2));
		expect(output(assembler.push(data(0xf0, 0, [4], { end: false }), receive(3))).status).toBe('failed');
		expect(assembler.stats().bytes).toBe(0);
		expect(output(assembler.push(data(0x10, 1), receive(4))).status).toBe('failed');
	});
	it('expires a pending ED gap even if normal messages keep arriving', () => {
		const assembler = session({ retentionMs: 20 });
		assembler.push(data(0x10, 1), receive());
		assembler.push(data(0xf0, 0), receive(10));
		const expired = assembler.push(data(0x10, 0), receive(20));
		expect(expired.discarded).toHaveLength(1);
		expect(output(expired).status).toBe('ignored');
	});
	it('does not let ED deliveries or duplicates extend a pending DT timeout', () => {
		const assembler = session({ retentionMs: 20 });
		assembler.push(data(0xf0, 0, [1], { end: false }), receive());
		assembler.push(data(0x10, 0), receive(10));
		assembler.push(data(0x10, 0), receive(19));
		expect(assembler.push(data(0xf0, 1), receive(20)).discarded).toHaveLength(1);
	});
	it('bounds ED pending/history bytes and counts them in statistics', () => {
		const assembler = session({ windowSize: 2 });
		for (let sequence = 0; sequence < 5; sequence++)
			assembler.push(data(0x10, sequence, new Uint8Array(16)), receive(sequence));
		expect(assembler.stats().bytes).toBe(32);
		expect(output(assembler.push(data(0x10, 7), receive(6))).status).toBe('ignored');
	});
	it('retains raw packet/result buffers independently of expedited duplicate history', () => {
		const assembler = session();
		const wire = data(0x10, 0, [9]);
		const result = assembler.push(wire, receive());
		wire.fill(0);
		result.packet.pdus[0].userData.fill(0);
		output(result).payload.fill(0);
		expect(output(assembler.push(data(0x10, 0, [9]), receive(1))).status).toBe('duplicate');
	});
	it.each([
		{ expedited: { startSequence: -1 } },
		{ expedited: { startSequence: 128 } },
		{ expedited: null },
		{ sourceReference: 0 },
		{ sourceReference: 65536 },
	])('validates negotiated service/reference options %j', (connection) => {
		expect(() => session({}, connection)).toThrow();
	});
});

describe('verified COTP passive disconnect handling', () => {
	it.each([0x80, 0xc0])('closes associated control %i and frees both sequence spaces', (type) => {
		const assembler = session();
		assembler.push(data(0xf0, 0, [1], { end: false }), receive());
		assembler.push(data(0x10, 1), receive(1));
		const closed = assembler.push(release(type), receive(2));
		expect(output(closed)).toMatchObject({ status: 'closed', fragments: 2 });
		expect(closed.discarded).toHaveLength(1);
		expect(assembler.stats()).toEqual({ connections: 0, bytes: 0 });
		expect(output(assembler.push(data(0xf0, 1), receive(3))).status).toBe('ignored');
	});
	it('requires the declared peer reference for releasing connection state', () => {
		for (const connection of [{ sourceReference: undefined }, { sourceReference: 3 }]) {
			const assembler = session({}, connection);
			assembler.push(data(0xf0, 0, [1], { end: false }), receive());
			expect(output(assembler.push(release(0x80), receive(1))).status).toBe('ignored');
			expect(output(assembler.push(data(0xf0, 1, [2]), receive(2))).payload).toEqual(Uint8Array.of(1, 2));
		}
	});
	it('does not close another receiver/direction or destination reference', () => {
		const assembler = session();
		expect(output(assembler.push(release(0x80), receive(1, 'other'))).status).toBe('ignored');
		expect(output(assembler.push(release(0xc0, { reference: 2 }), receive(2))).status).toBe('ignored');
		expect(assembler.stats().connections).toBe(1);
	});
	it('does not release on failed checksum or backwards reception', () => {
		const assembler = session();
		assembler.push(data(0xf0, 0, [1], { end: false }), receive(1));
		const corrupt = release(0x80);
		corrupt[corrupt.length - 1] ^= 1;
		expect(output(assembler.push(corrupt, receive(2))).status).toBe('failed');
		expect(output(assembler.push(release(0x80), receive(0))).status).toBe('failed');
		expect(assembler.stats().connections).toBe(1);
	});
	it('allows a verified matching disconnect to clear a failed connection', () => {
		const assembler = session();
		assembler.push(data(0xf0, 0, [1], { end: false }), receive());
		assembler.push(data(0xf0, 0, [2], { end: false }), receive(1));
		expect(output(assembler.push(release(0xc0), receive(2))).status).toBe('closed');
	});
});
