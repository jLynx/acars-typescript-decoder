import { describe, expect, it } from 'vitest';
import { createClnpReassembler, createX25Reassembler } from '@/index';

// Solve RFC 994's two modular checksum equations, independently of the parser's running sums.
function checksum(wire) {
	const header = wire.subarray(0, wire[1]);
	header[7] = header[8] = 0;
	const sum = header.reduce((total, byte) => total + byte, 0) % 255;
	const weighted = header.reduce((total, byte, index) => total + (index + 1) * byte, 0) % 255;
	header[7] = (weighted - 9 * sum + 255 * 256) % 255 || 255;
	header[8] = (-sum - header[7] + 510) % 255 || 255;
	return wire;
}

const data = Uint8Array.from([4, 0xf0, 0x12, 0x34, 0x80, ...Array.from({ length: 19 }, (_, index) => index + 1)]);
function fragment(
	start,
	end,
	{ payload = data, source = 2, destination = 1, id = 0x1234, lifetime = 120, options = [], flags = 0 } = {},
) {
	const length = 21 + options.length,
		total = length + payload.length,
		segment = length + end - start;
	return checksum(
		Uint8Array.from([
			0x81,
			length,
			1,
			lifetime,
			28 | 128 | (end < payload.length ? 64 : 0) | flags,
			segment >> 8,
			segment & 255,
			0,
			0,
			2,
			0x47,
			destination,
			2,
			0x47,
			source,
			id >> 8,
			id & 255,
			start >> 8,
			start & 255,
			total >> 8,
			total & 255,
			...options,
			...payload.slice(start, end),
		]),
	);
}
const reception = (receivedAt = 0, link = 'receiver/aircraft/downlink') => ({ receivedAt, link });

describe('bounded CLNP reassembly from RFC 994', () => {
	it('assembles offsets in any order, withholds gaps, and decodes only complete transport data', () => {
		const session = createClnpReassembler();
		const final = session.push(fragment(16, 24), reception());
		expect(final).toMatchObject({ status: 'pending', fragments: 1 });
		expect(final.payload).toBeUndefined();
		expect(final.packet.cotp).toBeUndefined();
		expect(session.push(fragment(0, 8), reception(1)).status).toBe('pending');
		const complete = session.push(fragment(8, 16), reception(2));
		expect(complete).toMatchObject({ status: 'complete', fragments: 3, cotp: { integrity: 'unverified' } });
		expect(complete.payload).toEqual(data);
		expect(complete.cotp.pdus[0].userData).toEqual(data.slice(5));
	});
	it('accepts byte-identical overlaps and suppresses both pending and completed retransmissions', () => {
		const session = createClnpReassembler();
		expect(session.push(fragment(0, 16), reception()).status).toBe('pending');
		expect(session.push(fragment(8, 16), reception(1))).toMatchObject({ status: 'duplicate', fragments: 1 });
		expect(session.push(fragment(8, 24), reception(2))).toMatchObject({ status: 'complete', fragments: 2 });
		expect(session.push(fragment(16, 24), reception(3))).toMatchObject({ status: 'duplicate', fragments: 2 });
		expect(session.stats()).toEqual({ assemblies: 1, bytes: 24 });
	});
	it('poisons conflicting overlaps, frees payload storage, and requires expiry or reset', () => {
		const session = createClnpReassembler();
		session.push(fragment(0, 16), reception());
		const wire = fragment(8, 24);
		wire[21] ^= 1; // CLNP header checksums do not protect the payload.
		expect(session.push(wire, reception(1))).toMatchObject({
			status: 'failed',
			reason: 'Overlapping fragment bytes conflict.',
		});
		expect(session.stats()).toEqual({ assemblies: 1, bytes: 0 });
		expect(session.push(fragment(16, 24), reception(2)).status).toBe('failed');
		session.reset(reception().link);
		expect(session.push(fragment(0, 24), reception(3)).status).toBe('complete');
	});
	it.each([{ options: [0xcd, 1, 1] }, { payload: Uint8Array.from([...data, ...data.slice(0, 8)]) }, { flags: 32 }])(
		'rejects conflicting total lengths, flags or option bytes: %j',
		(options) => {
			const session = createClnpReassembler();
			session.push(fragment(0, 8), reception());
			expect(session.push(fragment(8, 16, options), reception(1)).status).toBe('failed');
			expect(session.push(fragment(8, 24), reception(2)).payload).toBeUndefined();
		},
	);
	it('keeps identities separate by receiver/direction, both NSAPs and PDU identifier', () => {
		const session = createClnpReassembler();
		session.push(fragment(0, 16), reception());
		for (const options of [{ source: 3 }, { destination: 3 }, { id: 5 }])
			expect(session.push(fragment(16, 24, options), reception(1)).status).toBe('pending');
		expect(session.push(fragment(16, 24), reception(1, 'another receiver')).status).toBe('pending');
		expect(session.push(fragment(16, 24), reception(2)).status).toBe('complete');
		expect(session.stats().assemblies).toBe(5);
	});
	it('never accepts omitted/failed header checksums into an assembly', () => {
		const session = createClnpReassembler();
		session.push(fragment(0, 16), reception());
		const omitted = fragment(16, 24);
		omitted[7] = omitted[8] = 0;
		expect(session.push(omitted, reception(1))).toMatchObject({ status: 'failed', fragments: 0 });
		const failed = fragment(16, 24);
		failed[3] ^= 1;
		expect(session.push(failed, reception(2)).status).toBe('failed');
		expect(session.push(fragment(16, 24), reception(3))).toMatchObject({ status: 'complete', fragments: 2 });
	});
	it('uses the earliest lifetime deadline without extending it on duplicates', () => {
		const session = createClnpReassembler();
		session.push(fragment(0, 8, { lifetime: 4 }), reception());
		expect(session.push(fragment(0, 8, { lifetime: 120 }), reception(1000)).status).toBe('duplicate');
		const expired = session.push(fragment(8, 24), reception(2000));
		expect(expired).toMatchObject({ status: 'failed', reason: 'Fragment reception window expired.' });
		expect(expired.discarded).toHaveLength(1);
		expect(session.stats().bytes).toBe(0);
	});
	it('shortens deadlines for later PDUs with lower remaining lifetime', () => {
		const session = createClnpReassembler();
		session.push(fragment(0, 8), reception());
		session.push(fragment(8, 16, { lifetime: 2 }), reception(10));
		expect(session.push(fragment(16, 24), reception(1010)).status).toBe('failed');
	});
	it('expires by configured retention and rejects stale/out-of-order reception metadata', () => {
		const session = createClnpReassembler({ retentionMs: 20 });
		session.push(fragment(0, 8), reception(10));
		expect(session.push(fragment(8, 16), reception(9)).status).toBe('failed');
		expect(session.push(fragment(8, 16), reception(30)).status).toBe('failed');
		expect(session.push(fragment(0, 8, { id: 1 }), reception(100)).status).toBe('pending');
		expect(session.push(fragment(0, 24, { id: 2 }), reception(50)).status).toBe('failed');
	});
	it('rejects expired PDU lifetimes even for complete messages', () => {
		expect(createClnpReassembler().push(fragment(0, 24, { lifetime: 0 }), reception()).status).toBe('failed');
	});
	it('bounds messages, bytes and nonduplicate fragment count, and reports eviction', () => {
		const session = createClnpReassembler({ maxAssemblies: 1, maxFragments: 2 });
		session.push(fragment(0, 8), reception());
		session.push(fragment(8, 16), reception(1));
		expect(session.push(fragment(8, 16), reception(2)).status).toBe('duplicate');
		expect(session.push(fragment(16, 24), reception(3)).status).toBe('failed');
		expect(session.push(fragment(0, 8, { id: 2 }), reception(4)).discarded).toHaveLength(1);
		expect(session.stats()).toEqual({ assemblies: 1, bytes: 24 });
		expect(createClnpReassembler({ maxBytes: 23 }).push(fragment(0, 8), reception()).status).toBe('failed');
	});
	it('copies inputs and complete results so callers cannot change retained assembly bytes', () => {
		const session = createClnpReassembler();
		const first = fragment(0, 16);
		const pending = session.push(first, reception());
		first.fill(0);
		pending.packet.payload.fill(0);
		const result = session.push(fragment(16, 24), reception(1));
		expect(result.payload).toEqual(data);
		result.payload.fill(0);
		expect(session.push(fragment(0, 24), reception(2)).status).toBe('duplicate');
	});
	it('clears only the selected scope, then supports a full reset', () => {
		const session = createClnpReassembler();
		session.push(fragment(0, 8), reception());
		session.push(fragment(0, 8), reception(1, 'other'));
		session.reset(reception().link);
		expect(session.stats().assemblies).toBe(1);
		session.reset();
		expect(session.stats()).toEqual({ assemblies: 0, bytes: 0 });
	});
	it('accepts unsegmented verified messages without retaining state', () => {
		const segmented = fragment(0, 24);
		const wire = Uint8Array.from([...segmented.slice(0, 15), ...data]);
		wire[1] = 15;
		wire[4] = 28;
		wire[6] = wire.length;
		const session = createClnpReassembler();
		expect(session.push(checksum(wire), reception())).toMatchObject({
			status: 'complete',
			fragments: 1,
			payload: data,
		});
		expect(session.stats().assemblies).toBe(0);
	});
	it('composes with X.25 M-bit reassembly before joining CLNP offsets', () => {
		const x25 = createX25Reassembler(),
			clnp = createClnpReassembler();
		const first = fragment(0, 16),
			final = fragment(16, 24);
		expect(x25.push(Uint8Array.from([0x10, 1, 0x10, ...first.slice(0, 10)]), reception()).status).toBe('pending');
		const pdu = x25.push(Uint8Array.from([0x10, 1, 2, ...first.slice(10)]), reception(1));
		expect(clnp.push(pdu.payload, reception(1)).status).toBe('pending');
		const tail = x25.push(Uint8Array.from([0x10, 1, 4, ...final]), reception(2));
		expect(clnp.push(tail.payload, reception(2)).payload).toEqual(data);
	});
	it('dispatches only complete IDRP data and retains its uninterpreted body', () => {
		const payload = new Uint8Array(32);
		payload.set([0x85, 0, 32, 4]);
		payload[30] = 9;
		const session = createClnpReassembler();
		expect(session.push(fragment(0, 16, { payload }), reception()).idrp).toBeUndefined();
		const result = session.push(fragment(16, 32, { payload }), reception(1));
		expect(result.idrp).toMatchObject({ typeName: 'Keepalive', payload: Uint8Array.of(9, 0) });
		expect(result.cotp).toBeUndefined();
	});
	it('accepts the maximum payload size and rejects a declared larger assembly before allocation', () => {
		const payload = new Uint8Array(8192);
		const session = createClnpReassembler();
		expect(session.push(fragment(0, 4096, { payload }), reception()).status).toBe('pending');
		expect(session.stats().bytes).toBe(8192);
		expect(session.push(fragment(4096, 8192, { payload }), reception(1)).payload).toHaveLength(8192);
		expect(createClnpReassembler().push(fragment(0, 8, { payload: new Uint8Array(8193) }), reception()).status).toBe(
			'failed',
		);
	});
	it('leaves CLNP error-report bodies raw and outside reassembly state', () => {
		const wire = Uint8Array.of(0x81, 15, 1, 20, 1, 0, 16, 0, 0, 2, 0x47, 1, 2, 0x47, 2, 9);
		const session = createClnpReassembler();
		expect(session.push(checksum(wire), reception())).toMatchObject({
			status: 'ignored',
			packet: { type: 'Error Report' },
		});
		expect(session.stats().assemblies).toBe(0);
	});
	it.each([
		{ maxAssemblies: 0 },
		{ maxAssemblies: 257 },
		{ maxBytes: 8193 },
		{ maxFragments: 1025 },
		{ retentionMs: NaN },
	])('rejects invalid resource limits %j', (options) => {
		expect(() => createClnpReassembler(options)).toThrow(RangeError);
	});
	it.each([
		{ link: '', receivedAt: 0 },
		{ link: 'a\0b', receivedAt: 0 },
		{ link: 'a', receivedAt: Infinity },
	])('rejects invalid metadata %j', (metadata) => {
		expect(() => createClnpReassembler().push(fragment(0, 24), metadata)).toThrow(TypeError);
	});
	it('throws for malformed/truncated wire data', () => {
		const wire = fragment(0, 24);
		for (let end = 0; end < wire.length; end++)
			expect(() => createClnpReassembler().push(wire.slice(0, end), reception())).toThrow(TypeError);
	});
});
