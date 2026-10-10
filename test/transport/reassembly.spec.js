import { describe, expect, it } from 'vitest';
import { createX25Reassembler } from '@/index';

// Independent ISO 8208 modulo-8 header encoder; M=1 means more user data follows.
const wire = (sequence, more, payload, flags = 0x10, channel = 7) =>
	Uint8Array.from([flags, channel, (sequence << 1) | (more ? 0x10 : 0), ...payload]);
const reception = (receivedAt = 0, link = 'receiver:aircraft:ground:downlink') => ({ receivedAt, link });
// Minimal compressed CLNP plus a normal-format COTP data TPDU and raw user data.
const payload = Uint8Array.from([0, 20, 0, 1, 4, 0xf0, 0x12, 0x34, 0x83, 42, 43]);

describe('bounded X.25 M-bit reassembly', () => {
	it('decodes inner transport only after all consecutive fragments, including sequence wrap', () => {
		const session = createX25Reassembler();
		const first = session.push(wire(7, true, payload.slice(0, 5)), reception());
		expect(first.status).toBe('pending');
		expect(first.clnp).toBeUndefined();
		const final = session.push(wire(0, false, payload.slice(5)), reception(1));
		expect(final).toMatchObject({
			status: 'complete',
			fragments: 2,
			clnp: { localReference: 1, cotp: { integrity: 'unverified', pdus: [{ sendSequence: 3 }] } },
		});
		expect(final.payload).toEqual(payload);
		expect(final.clnp.cotp.pdus[0].userData).toEqual(Uint8Array.of(42, 43));
	});
	it('ignores changed receive acknowledgements on exact retransmissions', () => {
		const session = createX25Reassembler();
		const first = wire(2, true, payload.slice(0, 4));
		session.push(first, reception());
		first[2] |= 0xe0;
		expect(session.push(first, reception(1))).toMatchObject({ status: 'duplicate', fragments: 1 });
		const last = wire(3, false, payload.slice(4));
		expect(session.push(last, reception(2)).payload).toEqual(payload);
		expect(session.push(last, reception(3)).status).toBe('duplicate');
		expect(session.push(wire(4, false, [9]), reception(4)).payload).toEqual(Uint8Array.of(9));
	});
	it('poisons conflicting or missing sequences until circuit reset', () => {
		const session = createX25Reassembler();
		const first = wire(1, true, [1]);
		session.push(first, reception());
		expect(session.push(wire(1, true, [2]), reception(1)).status).toBe('failed');
		expect(session.push(first, reception(2)).status).toBe('failed');
		expect(session.push(wire(2, false, [3]), reception(3)).payload).toBeUndefined();
		session.reset(reception().link);
		session.push(first, reception(4));
		expect(session.push(wire(3, false, [3]), reception(5)).reason).toMatch(/sequence/);
	});
	it('rejects conflicting content even after completion', () => {
		const session = createX25Reassembler();
		session.push(wire(1, false, [1]), reception());
		expect(session.push(wire(1, false, [2]), reception(1)).status).toBe('failed');
		expect(session.push(wire(2, false, [3]), reception(2)).status).toBe('failed');
	});
	it('withholds independently plausible inner data on a failed final fragment', () => {
		const session = createX25Reassembler();
		session.push(wire(0, true, [1]), reception());
		const failed = session.push(wire(2, false, payload), reception(1));
		expect(failed.status).toBe('failed');
		expect(failed.packet.clnp).toBeUndefined();
		expect(failed.clnp).toBeUndefined();
	});
	it('keeps a completed channel poisoned after an unsupported circuit control', () => {
		const session = createX25Reassembler();
		session.push(wire(0, false, [1]), reception());
		expect(session.push(Uint8Array.of(0x10, 7, 0x1b), reception(1)).status).toBe('failed');
		expect(session.push(wire(1, false, [2]), reception(2)).status).toBe('failed');
	});
	it('isolates links, directions and logical channels', () => {
		const session = createX25Reassembler();
		session.push(wire(0, true, [1]), reception(0, 'a'));
		session.push(wire(0, true, [2]), reception(0, 'b'));
		session.push(wire(0, true, [3], 0x11), reception(0, 'a'));
		expect(session.push(wire(1, false, [4]), reception(1, 'b')).payload).toEqual(Uint8Array.of(2, 4));
		expect(session.push(wire(1, false, [4]), reception(1, 'a')).payload).toEqual(Uint8Array.of(1, 4));
		expect(session.push(wire(1, false, [4], 0x11), reception(1, 'a')).payload).toEqual(Uint8Array.of(3, 4));
	});
	it('does not let callers mutate retained packets or assembled payloads', () => {
		const session = createX25Reassembler();
		const first = session.push(wire(0, true, [1]), reception());
		first.packet.payload[0] = 99;
		first.packet.sendSequence = 5;
		const final = session.push(wire(1, false, [2]), reception(1));
		expect(final.payload).toEqual(Uint8Array.of(1, 2));
		final.payload[1] = 99;
		final.packet.payload[0] = 99;
		expect(session.push(wire(1, false, [2]), reception(2)).status).toBe('duplicate');
	});
	it('bounds bytes, fragments, channels and reception lifetime', () => {
		const session = createX25Reassembler({ maxBytes: 2, maxFragments: 2, maxChannels: 1, retentionMs: 10 });
		session.push(wire(0, true, [1]), reception());
		expect(session.push(wire(1, false, [2, 3]), reception(1)).status).toBe('failed');
		const replaced = session.push(wire(0, true, [4]), reception(2, 'another'));
		expect(replaced.discarded).toHaveLength(1);
		expect(session.stats()).toEqual({ channels: 1, bytes: 1 });
		const expired = session.push(wire(1, false, [5]), reception(13, 'another'));
		expect(expired.status).toBe('failed');
		expect(expired.discarded).toHaveLength(1);
		expect(session.stats()).toEqual({ channels: 0, bytes: 0 });
		expect(session.push(wire(2, false, [1]), reception(0)).status).toBe('failed');
		const fragments = createX25Reassembler({ maxFragments: 1 });
		fragments.push(wire(0, true, [1]), reception());
		expect(fragments.push(wire(1, false, [2]), reception(1)).status).toBe('failed');
	});
	it('rejects inconsistent flags and interrupted circuits; permits receive-ready control', () => {
		const session = createX25Reassembler();
		session.push(wire(0, true, [1]), reception());
		expect(session.push(Uint8Array.of(0x10, 7, 1), reception(1)).status).toBe('ignored');
		expect(session.push(wire(1, false, [2], 0x90), reception(2)).reason).toMatch(/flags/);
		session.reset();
		session.push(wire(0, true, [1]), reception());
		expect(session.push(Uint8Array.of(0x10, 7, 0x1b), reception(1)).status).toBe('failed');
	});
	it('rejects malformed inputs and out-of-order reception metadata', () => {
		for (const option of [{ maxBytes: 8193 }, { maxChannels: 0 }, { maxFragments: 1.5 }, { retentionMs: Infinity }])
			expect(() => createX25Reassembler(option)).toThrow();
		const session = createX25Reassembler();
		expect(() => session.push(Uint8Array.of(0), reception())).toThrow();
		expect(() => session.push(wire(0, false, []), reception(NaN))).toThrow();
		expect(() => session.push(wire(0, false, []), reception(0, ''))).toThrow();
		session.push(wire(0, true, [1]), reception(1));
		session.push(wire(1, true, [2]), reception(3));
		expect(session.push(wire(2, false, [3]), reception(2)).reason).toMatch(/order/);
	});
	it('accepts a new packet after a completed assembly has expired', () => {
		const session = createX25Reassembler({ retentionMs: 10 });
		session.push(wire(0, false, [1]), reception());
		expect(session.push(wire(0, false, [2]), reception(11))).toMatchObject({
			status: 'complete',
			payload: Uint8Array.of(2),
		});
	});
});
