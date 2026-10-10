import { describe, expect, it } from 'vitest';
import { createCotpReassembler, createClnpReassembler } from '@/index';
import { createCotpReassembler as framingReassembler } from '@/framing';

// Independent solution of RFC 905's sum and position-weighted sum equations.
function checksum(bytes, offset) {
	bytes[offset] = bytes[offset + 1] = 0;
	const sum = bytes.reduce((total, byte) => total + byte, 0) % 255;
	const weighted = bytes.reduce((total, byte, index) => total + (index + 1) * byte, 0) % 255;
	const x = (weighted - (offset + 2) * sum + 255 * 256) % 255;
	bytes[offset] = x;
	bytes[offset + 1] = (-sum - x + 510) % 255;
	return bytes;
}

function dt(
	sequence,
	end,
	data = [sequence & 255],
	{ reference = 1, format = 'normal', options = [], checksumPresent = true } = {},
) {
	const encoded =
		format === 'normal'
			? [sequence | (end ? 128 : 0)]
			: [(sequence >>> 24) | (end ? 128 : 0), (sequence >>> 16) & 255, (sequence >>> 8) & 255, sequence & 255];
	const header = [0xf0, reference >> 8, reference & 255, ...encoded, ...options];
	const checksumOffset = 1 + header.length + 2;
	if (checksumPresent) header.push(0xc3, 2, 0, 0);
	const bytes = Uint8Array.from([header.length, ...header, ...data]);
	return checksumPresent ? checksum(bytes, checksumOffset) : bytes;
}

const receive = (receivedAt = 0, link = 'receiver/source/destination/generation/downlink') => ({ link, receivedAt });
function session(options = {}, connection = {}) {
	const assembler = createCotpReassembler(options);
	assembler.open({ link: receive().link, destinationReference: 1, format: 'normal', ...connection }, 0);
	return assembler;
}
const output = (result) => result.assemblies[0];

describe('passive class-4 COTP DT message reassembly from RFC 905', () => {
	it('joins in-sequence DTs until EOT and preserves numbering across messages', () => {
		const assembler = session();
		expect(output(assembler.push(dt(0, false, [1, 2]), receive()))).toMatchObject({
			status: 'pending',
			fragments: 1,
			firstSequence: 0,
		});
		const complete = output(assembler.push(dt(1, true, [3]), receive(1)));
		expect(complete).toMatchObject({
			status: 'complete',
			fragments: 2,
			firstSequence: 0,
			lastSequence: 1,
			payload: Uint8Array.of(1, 2, 3),
		});
		expect(output(assembler.push(dt(2, true, [4]), receive(2)))).toMatchObject({
			status: 'complete',
			fragments: 1,
			firstSequence: 2,
			lastSequence: 2,
		});
	});
	it('holds out-of-order EOT data until all preceding DTs arrive', () => {
		const assembler = session();
		expect(output(assembler.push(dt(2, true, [3]), receive())).status).toBe('pending');
		expect(output(assembler.push(dt(0, false, [1]), receive(1))).payload).toBeUndefined();
		expect(output(assembler.push(dt(1, false, [2]), receive(2))).payload).toEqual(Uint8Array.of(1, 2, 3));
	});
	it('releases multiple complete TSDUs when one gap is filled', () => {
		const assembler = session();
		assembler.push(dt(1, true, [2]), receive());
		assembler.push(dt(2, true, [3]), receive(1));
		const complete = assembler.push(dt(0, true, [1]), receive(2)).assemblies;
		expect(complete.map((part) => [...part.payload])).toEqual([[1], [2], [3]]);
		expect(complete.map((part) => part.firstSequence)).toEqual([0, 1, 2]);
	});
	it('suppresses buffered, consumed-pending and completed duplicates', () => {
		const assembler = session();
		assembler.push(dt(1, true, [2]), receive());
		expect(output(assembler.push(dt(1, true, [2]), receive(1))).status).toBe('duplicate');
		expect(output(assembler.push(dt(0, false, [1]), receive(2))).status).toBe('complete');
		expect(output(assembler.push(dt(0, false, [1]), receive(3))).status).toBe('duplicate');
		expect(output(assembler.push(dt(1, true, [2]), receive(4))).payload).toBeUndefined();
	});
	it.each([
		['buffered', 1, true],
		['pending', 0, false],
		['complete', 0, true],
	])('rejects conflicting %s retransmissions and frees retained state', (_, sequence, end) => {
		const assembler = session();
		assembler.push(dt(sequence, end, [1]), receive());
		expect(output(assembler.push(dt(sequence, end, [2]), receive(1)))).toMatchObject({
			status: 'failed',
			reason: 'Retransmitted sequence has conflicting data or EOT.',
		});
		expect(assembler.stats().bytes).toBe(0);
		expect(output(assembler.push(dt(0, true), receive(2))).status).toBe('failed');
	});
	it('rejects changed EOT for a retransmitted sequence', () => {
		const assembler = session();
		assembler.push(dt(0, false), receive());
		expect(output(assembler.push(dt(0, true), receive(1))).status).toBe('failed');
	});
	it('handles normal modulo-128 and extended modulo-2^31 wraparound', () => {
		for (const [format, startSequence] of [
			['normal', 127],
			['extended', 2 ** 31 - 1],
		]) {
			const assembler = session({}, { format, startSequence });
			assembler.push(dt(0, true, [2], { format }), receive());
			const complete = output(assembler.push(dt(startSequence, false, [1], { format }), receive(1)));
			expect(complete).toMatchObject({
				status: 'complete',
				firstSequence: startSequence,
				lastSequence: 0,
				payload: Uint8Array.of(1, 2),
			});
		}
	});
	it('keeps repeated normal sequence cycles separate as older history is evicted', () => {
		const assembler = session();
		for (let index = 0; index < 300; index++) {
			const sequence = index % 128;
			const complete = output(assembler.push(dt(sequence, true, [index >> 8, index & 255]), receive(index)));
			expect(complete).toMatchObject({ status: 'complete', firstSequence: sequence, lastSequence: sequence });
			expect(complete.payload).toEqual(Uint8Array.of(index >> 8, index & 255));
		}
		expect(assembler.stats().bytes).toBeLessThanOrEqual(64);
	});
	it('remembers every consumed fragment of an incomplete message beyond the completed-history window', () => {
		const assembler = session({ windowSize: 4 });
		for (let sequence = 0; sequence < 8; sequence++) assembler.push(dt(sequence, false), receive(sequence));
		expect(output(assembler.push(dt(0, false), receive(8))).status).toBe('duplicate');
		expect(output(assembler.push(dt(0, false, [99]), receive(9))).status).toBe('failed');
	});
	it('rejects a normal-format incomplete message before its own sequence numbers are reused', () => {
		const assembler = session({ maxFragments: 256 });
		let result;
		for (let sequence = 0; sequence < 128; sequence++)
			result = output(assembler.push(dt(sequence, false, []), receive(sequence)));
		expect(result).toMatchObject({ status: 'failed', reason: 'Incomplete message exhausts the sequence space.' });
		expect(assembler.stats().bytes).toBe(0);
	});
	it('uses the negotiated format when sequence/TLV layouts are ambiguous', () => {
		const assembler = session({}, { format: 'extended' });
		// Extended fixed bytes after normal sequence location also form a valid normal TLV [0xc0,1,10].
		assembler.open({ link: receive().link, destinationReference: 1, format: 'extended', startSequence: 0xc0010a }, 0);
		expect(output(assembler.push(dt(0xc0010a, true, [9], { format: 'extended' }), receive()))).toMatchObject({
			status: 'complete',
			firstSequence: 0xc0010a,
		});
	});
	it('ignores sequences outside the bounded forward window and allows later recovery', () => {
		const assembler = session({ windowSize: 4 });
		expect(output(assembler.push(dt(4, true), receive())).status).toBe('ignored');
		expect(output(assembler.push(dt(127, true), receive(1))).status).toBe('ignored');
		expect(output(assembler.push(dt(0, true), receive(2))).status).toBe('complete');
	});
	it('requires an explicitly opened connection/message boundary', () => {
		const assembler = createCotpReassembler();
		expect(output(assembler.push(dt(0, true), receive())).status).toBe('ignored');
		expect(assembler.stats()).toEqual({ connections: 0, bytes: 0 });
		assembler.open({ link: receive().link, destinationReference: 1, format: 'normal', startSequence: 5 }, 0);
		expect(output(assembler.push(dt(5, true), receive())).status).toBe('complete');
	});
	it('isolates identical destination references by receiver/NSAPs/direction/connection generation', () => {
		const assembler = session();
		assembler.open({ link: 'other', destinationReference: 1, format: 'normal' }, 0);
		assembler.open({ link: receive().link, destinationReference: 2, format: 'normal' }, 0);
		assembler.push(dt(0, false, [1]), receive());
		expect(output(assembler.push(dt(1, true, [2]), receive(1, 'other'))).status).toBe('pending');
		expect(output(assembler.push(dt(1, true, [3], { reference: 2 }), receive(1))).status).toBe('pending');
		expect(output(assembler.push(dt(1, true, [4]), receive(2))).payload).toEqual(Uint8Array.of(1, 4));
	});
	it('rejects corrupt/missing checksums without changing accepted message data', () => {
		const assembler = session();
		assembler.push(dt(0, false, [1]), receive());
		const corrupt = dt(1, true, [2]);
		corrupt[corrupt.length - 1] ^= 1;
		expect(output(assembler.push(corrupt, receive(1))).status).toBe('failed');
		expect(output(assembler.push(dt(1, true, [2], { checksumPresent: false }), receive(2))).status).toBe('failed');
		expect(output(assembler.push(dt(1, true, [2]), receive(3))).payload).toEqual(Uint8Array.of(1, 2));
	});
	it('rejects the whole NSDU if a preceding concatenated control TPDU checksum fails', () => {
		const assembler = session();
		const ack = checksum(Uint8Array.of(8, 0x60, 0, 2, 0, 0xc3, 2, 0, 0), 7);
		ack[2] ^= 1;
		expect(output(assembler.push(Uint8Array.from([...ack, ...dt(0, true)]), receive())).status).toBe('failed');
		expect(assembler.stats().bytes).toBe(0);
	});
	it('parses concatenated controls using each connection format and leaves controls for caller handling', () => {
		const assembler = session({}, { format: 'extended' });
		assembler.open({ link: receive().link, destinationReference: 2, format: 'normal' }, 0);
		const ack = checksum(Uint8Array.of(8, 0x60, 0, 2, 0, 0xc3, 2, 0, 0), 7);
		const result = assembler.push(Uint8Array.from([...ack, ...dt(0, true, [9], { format: 'extended' })]), receive());
		expect(result.assemblies.map((part) => part.status)).toEqual(['ignored', 'complete']);
		expect(result.packet.pdus.map((pdu) => pdu.format)).toEqual(['normal', 'extended']);
	});
	it('leaves verified expedited data raw without advancing the normal DT sequence', () => {
		const assembler = session();
		const expedited = dt(0, true, [9]);
		expedited[1] = 0x10;
		checksum(expedited, 7);
		const ignored = assembler.push(expedited, receive());
		expect(output(ignored).status).toBe('ignored');
		expect(ignored.packet.pdus[0].userData).toEqual(Uint8Array.of(9));
		expect(output(assembler.push(dt(0, true, [1]), receive(1))).payload).toEqual(Uint8Array.of(1));
	});
	it('retains unknown parameter bytes while using verified data', () => {
		const result = session().push(dt(0, true, [9], { options: [0xee, 1, 2] }), receive());
		expect(output(result).payload).toEqual(Uint8Array.of(9));
		expect(result.packet.coverage).toBe('partial');
	});
	it('expires pending data despite duplicates and never guesses a new boundary', () => {
		const assembler = session({ retentionMs: 20 });
		assembler.push(dt(0, false), receive());
		assembler.push(dt(0, false), receive(10));
		const expired = assembler.push(dt(1, true), receive(20));
		expect(expired.discarded).toHaveLength(1);
		expect(output(expired).status).toBe('ignored');
		expect(assembler.stats().connections).toBe(0);
	});
	it('expires idle connections and refuses stale or backwards reception metadata', () => {
		const assembler = session({ retentionMs: 20 });
		assembler.push(dt(0, true), receive(1));
		expect(output(assembler.push(dt(1, true), receive(0))).status).toBe('failed');
		expect(assembler.push(dt(1, true), receive(21)).discarded).toHaveLength(1);
		expect(() => assembler.open({ link: 'other', destinationReference: 1, format: 'normal' }, 0)).toThrow(RangeError);
	});
	it('bounds total pending bytes, fragment count and buffered out-of-order messages', () => {
		const limited = session({ maxBytes: 3 });
		limited.push(dt(0, false, [1, 2]), receive());
		expect(output(limited.push(dt(1, true, [3, 4]), receive(1))).status).toBe('failed');
		const count = session({ maxFragments: 2 });
		count.push(dt(2, true), receive());
		count.push(dt(1, true), receive(1));
		expect(output(count.push(dt(0, true), receive(2))).status).toBe('failed');
	});
	it('bounds duplicate history by count and bytes independently of completed message size', () => {
		const assembler = session({ windowSize: 2, maxBytes: 3 });
		for (let sequence = 0; sequence < 10; sequence++)
			expect(output(assembler.push(dt(sequence, true, [1, 2]), receive(sequence))).status).toBe('complete');
		expect(assembler.stats().bytes).toBeLessThanOrEqual(3);
		expect(output(assembler.push(dt(0, true, [1, 2]), receive(11))).status).toBe('ignored');
	});
	it('can assemble 64 KiB from individually bounded TPDUs', () => {
		const assembler = session();
		let result;
		for (let sequence = 0; sequence < 16; sequence++)
			result = output(
				assembler.push(dt(sequence, sequence === 15, new Uint8Array(4096).fill(sequence)), receive(sequence)),
			);
		expect(result.payload).toHaveLength(65536);
		expect(result.payload[4096]).toBe(1);
		expect(result.payload[65535]).toBe(15);
	});
	it('supports empty TSDUs and a fragment-count limit without data bytes', () => {
		expect(output(session().push(dt(0, true, []), receive())).payload).toEqual(new Uint8Array());
		const assembler = session({ maxFragments: 1 });
		assembler.push(dt(0, false, []), receive());
		expect(output(assembler.push(dt(1, true, []), receive(1))).status).toBe('failed');
	});
	it('copies received and assembled buffers so callers cannot alter retained state', () => {
		const assembler = session();
		const wire = dt(0, false, [1]);
		const pending = assembler.push(wire, receive());
		wire.fill(0);
		pending.packet.pdus[0].userData.fill(0);
		const complete = output(assembler.push(dt(1, true, [2]), receive(1)));
		expect(complete.payload).toEqual(Uint8Array.of(1, 2));
		complete.payload.fill(0);
		expect(output(assembler.push(dt(0, false, [1]), receive(2))).status).toBe('duplicate');
	});
	it('reopening establishes a new boundary and clears failed or reused-reference state', () => {
		const assembler = session();
		assembler.push(dt(0, false, [1]), receive());
		assembler.push(dt(0, true, [2]), receive(1));
		assembler.open({ link: receive().link, destinationReference: 1, format: 'normal', startSequence: 7 }, 2);
		expect(output(assembler.push(dt(7, true, [9]), receive(2))).payload).toEqual(Uint8Array.of(9));
	});
	it('reports connection eviction and supports selective/full reset', () => {
		const assembler = session({ maxConnections: 2 });
		assembler.open({ link: receive().link, destinationReference: 2, format: 'normal' }, 0);
		expect(assembler.open({ link: 'other', destinationReference: 1, format: 'normal' }, 0)).toHaveLength(1);
		assembler.reset(receive().link, 2);
		expect(assembler.stats().connections).toBe(1);
		assembler.reset();
		expect(assembler.stats()).toEqual({ connections: 0, bytes: 0 });
	});
	it('composes after verified CLNP reassembly', () => {
		const transport = dt(0, true, [1, 2, 3]);
		const wire = Uint8Array.from([
			0x81,
			15,
			1,
			20,
			28,
			0,
			15 + transport.length,
			0,
			0,
			2,
			0x47,
			1,
			2,
			0x47,
			2,
			...transport,
		]);
		checksum(wire.subarray(0, 15), 7);
		wire[7] ||= 255;
		wire[8] ||= 255;
		const clnp = createClnpReassembler().push(wire, receive());
		expect(output(session().push(clnp.payload, receive())).payload).toEqual(Uint8Array.of(1, 2, 3));
	});
	it.each([
		{ maxConnections: 0 },
		{ maxConnections: 257 },
		{ maxBytes: 65537 },
		{ maxFragments: 1025 },
		{ windowSize: 64 },
		{ retentionMs: NaN },
	])('rejects invalid limits %j', (options) => {
		expect(() => createCotpReassembler(options)).toThrow(RangeError);
	});
	it.each([
		{ destinationReference: 0 },
		{ destinationReference: 65536 },
		{ format: 'invalid' },
		{ startSequence: 128 },
		{ link: '' },
	])('rejects invalid connection declarations %j', (connection) => {
		expect(() => session({}, connection)).toThrow();
	});
	it('rejects malformed and oversize input without releasing data', () => {
		const assembler = session();
		expect(() => assembler.push(new Uint8Array(8193), receive())).toThrow(TypeError);
		expect(output(assembler.push(Uint8Array.of(255, 0), receive())).status).toBe('failed');
		expect(() => assembler.push(dt(0, true), { link: 'test', receivedAt: Infinity })).toThrow(TypeError);
	});
	it('rejects unparsed trailing controls and truncated data before mutating connection state', () => {
		const assembler = session();
		const control = checksum(Uint8Array.of(8, 0x60, 0, 1, 0, 0xc3, 2, 0, 0), 7);
		const result = assembler.push(Uint8Array.from([...control, 255, 0]), receive());
		expect(output(result).status).toBe('failed');
		expect(result.packet.unconsumed).toEqual(Uint8Array.of(255, 0));
		const wire = dt(0, true, [1, 2, 3]);
		for (let end = 2; end < wire.length; end++)
			expect(output(assembler.push(wire.slice(0, end), receive())).status).toBe('failed');
		expect(output(assembler.push(wire, receive())).status).toBe('complete');
	});
	it('exports the same passive API from the framing entry point', () => {
		expect(framingReassembler().stats()).toEqual({ connections: 0, bytes: 0 });
	});
});
