import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { ack, data, establish, receive, release } from './wire';
const event = (r) => r.events.at(-1);
const configured = { additional: 0x41 };
const dependency = (n, extended = false) => [
	0x90,
	extended ? [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] : [n >> 8, n & 255],
];
describe('COTP EA evidence and non-blocking ED dependency ordering', () => {
	it('does not queue later EDs and deliver several observed outstanding EDs on a gap fill', () => {
		const s = createCotpSession();
		establish(s);
		expect(s.push(data(1, [2], { expedited: true }), receive(1)).assemblies[0].status).toBe('ignored');
		expect(s.stats().bytes).toBe(0);
		expect(s.push(data(0, [1], { expedited: true }), receive(2)).assemblies).toHaveLength(1);
		expect(s.push(data(1, [2], { expedited: true }), receive(3)).assemblies[0].status).toBe('ignored');
		s.push(ack(0, { expedited: true }), receive(4, 'b-to-a'));
		expect(s.push(data(1, [2], { expedited: true }), receive(5)).assemblies[0].status).toBe('complete');
	});
	it('does not release uncaptured ED-dependent payload on an EA alone', () => {
		const s = createCotpSession();
		establish(s, configured, configured);
		s.push(data(0, [2], { parameters: [dependency(0)] }), receive(1));
		const r = s.push(ack(0, { expedited: true }), receive(2, 'b-to-a'));
		expect(r.assemblies).toEqual([]);
		expect(event(r).acknowledgement.dataObserved).toBe(false);
		expect(s.stats().bytes).toBe(1);
	});
	it('enforces the fragment bound while waiting for a dependency', () => {
		const s = createCotpSession({ maxFragments: 1 });
		establish(s, configured, configured);
		s.push(data(0, [1], { parameters: [dependency(0)] }), receive(1));
		expect(event(s.push(data(1, [2]), receive(2))).status).toBe('closed');
		expect(s.stats().bytes).toBe(0);
	});
	it('keeps a pending EA from being cleared by malformed EA TLVs', () => {
		const s = createCotpSession();
		establish(s);
		s.push(data(0, [1], { expedited: true }), receive(1));
		expect(event(s.push(ack(0, { expedited: true, parameters: [[0x8a, [0, 1]]] }), receive(2, 'b-to-a'))).status).toBe(
			'failed',
		);
		expect(s.push(data(1, [2], { expedited: true }), receive(3)).assemblies[0].status).toBe('ignored');
		expect(event(s.push(ack(0, { expedited: true }), receive(4, 'b-to-a'))).status).toBe('acknowledged');
	});
	it('reports a pending blocking EA on normal data without inferring the TS-user request order', () => {
		const s = createCotpSession();
		establish(s);
		s.push(data(0, [1], { expedited: true }), receive(1));
		expect(s.push(data(), receive(2)).assemblies[0].transmission.awaitingExpeditedAcknowledgement).toBe(true);
		s.push(ack(0, { expedited: true }), receive(3, 'b-to-a'));
		expect(s.push(data(1), receive(4)).assemblies[0].transmission.awaitingExpeditedAcknowledgement).toBe(false);
	});
	it('releases a dependency whose ED sequence wraps to zero', () => {
		const s = createCotpSession();
		establish(s, configured, configured);
		for (let i = 0; i < 128; i++) {
			s.push(data(i, [1], { expedited: true }), receive(i * 2 + 1));
			s.push(ack(i, { expedited: true }), receive(i * 2 + 2, 'b-to-a'));
		}
		expect(s.push(data(0, [2], { parameters: [dependency(0)] }), receive(257)).assemblies[0].status).toBe('pending');
		expect(s.push(data(0, [1], { expedited: true }), receive(258)).assemblies.map((p) => p.service)).toEqual([
			'expedited',
			'normal',
		]);
	});
	it.each([false, true])('holds DT behind an undelivered ED in extended=%s format', (extended) => {
		const s = createCotpSession();
		establish(s, { ...configured, extended }, { ...configured, extended });
		const held = s.push(data(0, [2], { extended, parameters: [dependency(0, extended)] }), receive(1));
		expect(held.assemblies[0].status).toBe('pending');
		expect(s.stats().bytes).toBe(1);
		const r = s.push(data(0, [1], { extended, expedited: true }), receive(2));
		expect(r.assemblies.map((p) => [p.service, p.status, [...p.payload]])).toEqual([
			['expedited', 'complete', [1]],
			['normal', 'complete', [2]],
		]);
		expect(event(s.push(ack(0, { extended, expedited: true }), receive(3, 'b-to-a')))).toMatchObject({
			status: 'acknowledged',
			acknowledgement: { service: 'expedited', sequence: 0, dataObserved: true },
		});
	});
	it.each(['a-to-b', 'b-to-a'])('keeps dependencies in their own direction %s', (direction) => {
		const s = createCotpSession();
		establish(s, configured, configured);
		const opposite = direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
		const ref = direction === 'a-to-b' ? 22 : 11;
		s.push(data(0, [2], { reference: ref, parameters: [dependency(0)] }), receive(1, direction));
		expect(
			s.push(data(0, [8], { expedited: true, reference: opposite === 'a-to-b' ? 22 : 11 }), receive(2, opposite))
				.assemblies,
		).toHaveLength(1);
		expect(
			s.push(data(0, [1], { expedited: true, reference: ref }), receive(3, direction)).assemblies.map((p) => p.service),
		).toEqual(['expedited', 'normal']);
	});
	it('holds all later DTs and releases complete multi-fragment TSDUs in order', () => {
		const s = createCotpSession();
		establish(s, configured, configured);
		s.push(data(0, [2], { end: false, parameters: [dependency(0)] }), receive(1));
		s.push(data(1, [3]), receive(2));
		s.push(data(2, [4]), receive(3));
		const r = s.push(data(0, [1], { expedited: true }), receive(4));
		expect(r.assemblies.map((p) => [...p.payload])).toEqual([[1], [2, 3], [4]]);
		expect(r.assemblies.map((p) => p.firstSequence)).toEqual([0, 0, 2]);
	});
	it('accepts an already-delivered dependency and does not reopen an acknowledged ED on duplicate', () => {
		const s = createCotpSession();
		establish(s, configured, configured);
		s.push(data(0, [1], { expedited: true }), receive(1));
		s.push(ack(0, { expedited: true }), receive(2, 'b-to-a'));
		expect(s.push(data(0, [2], { parameters: [dependency(0)] }), receive(3)).assemblies[0].status).toBe('complete');
		expect(s.push(data(0, [1], { expedited: true }), receive(4)).assemblies[0].status).toBe('duplicate');
		expect(s.push(data(1, [3], { expedited: true }), receive(5)).assemblies[0].status).toBe('complete');
	});
	it('keeps one outstanding ED per direction until a matching EA is observed', () => {
		const s = createCotpSession();
		establish(s);
		s.push(data(0, [1], { expedited: true }), receive(1));
		expect(s.push(data(1, [2], { expedited: true }), receive(2)).assemblies[0].status).toBe('ignored');
		expect(event(s.push(ack(1, { expedited: true }), receive(3, 'b-to-a'))).status).toBe('ignored');
		expect(event(s.push(ack(0, { expedited: true }), receive(4, 'b-to-a'))).status).toBe('acknowledged');
		expect(s.push(data(1, [2], { expedited: true }), receive(5)).assemblies[0].status).toBe('complete');
	});
	it('ignores unsolicited, repeated or mismatched EAs without acknowledging future EDs', () => {
		const s = createCotpSession();
		establish(s);
		expect(event(s.push(ack(0, { expedited: true }), receive(1, 'b-to-a'))).acknowledgement.dataObserved).toBe(false);
		s.push(data(0, [1], { expedited: true }), receive(2));
		s.push(ack(0, { expedited: true }), receive(3, 'b-to-a'));
		expect(event(s.push(ack(0, { expedited: true }), receive(4, 'b-to-a'))).status).toBe('ignored');
		expect(s.push(data(1, [2], { expedited: true }), receive(5)).assemblies[0].status).toBe('complete');
	});
	it.each([
		[[], false],
		[[0], false],
		[[0, 0, 0], false],
		[[0, 128], false],
		[[128, 0, 0, 0], true],
		[[0, 0, 0], true],
	])('rejects dependency length/sequence %j extended=%s', (raw, extended) => {
		const s = createCotpSession();
		establish(s, { ...configured, extended }, { ...configured, extended });
		expect(event(s.push(data(0, [1], { extended, parameters: [[0x90, raw]] }), receive(1))).status).toBe('failed');
		expect(s.push(data(0, [1], { extended }), receive(2)).assemblies[0].status).toBe('complete');
	});
	it('rejects dependency parameters without negotiated non-blocking service', () => {
		const s = createCotpSession();
		establish(s);
		expect(event(s.push(data(0, [1], { parameters: [dependency(0)] }), receive(1))).status).toBe('failed');
		const t = createCotpSession();
		establish(t, { additional: 0 }, { additional: 0 });
		expect(event(t.push(ack(0, { expedited: true }), receive(1, 'b-to-a'))).status).toBe('failed');
	});
	it('uses the final dependency TLV and detects dependency-changing retransmissions', () => {
		const s = createCotpSession();
		establish(s, configured, configured);
		const r = s.push(data(0, [1], { parameters: [[0x90, []], dependency(0)] }), receive(1));
		expect(r.assemblies[0].status).toBe('pending');
		expect(event(s.push(data(0, [1], { parameters: [dependency(1)] }), receive(2))).status).toBe('closed');
		expect(s.stats().bytes).toBe(0);
	});
	it.each([false, true])('tracks ED sequence wrap with extended=%s', (extended) => {
		const s = createCotpSession();
		establish(s, { ...configured, extended }, { ...configured, extended });
		const count = extended ? 3 : 129;
		for (let i = 0; i < count; i++) {
			const seq = extended ? i : i % 128;
			expect(s.push(data(seq, [1], { expedited: true, extended }), receive(i * 2 + 1)).assemblies[0].status).toBe(
				'complete',
			);
			expect(event(s.push(ack(seq, { expedited: true, extended }), receive(i * 2 + 2, 'b-to-a'))).status).toBe(
				'acknowledged',
			);
		}
	});
	it('does not let one direction or duplicates extend a held dependency deadline', () => {
		const s = createCotpSession({ retentionMs: 10 });
		establish(s, configured, configured);
		s.push(data(0, [1], { parameters: [dependency(0)] }), receive(1));
		s.push(data(0, [1], { parameters: [dependency(0)] }), receive(9));
		expect(s.push(data(0, [2], { reference: 11 }), receive(11, 'b-to-a')).discarded).toEqual(['cotp-1']);
		expect(s.stats().bytes).toBe(0);
	});
	it('bounds held dependency bytes and fragments then releases them on reset/release', () => {
		const s = createCotpSession({ maxBytes: 2 });
		establish(s, configured, configured);
		s.push(data(0, [1, 2], { parameters: [dependency(0)] }), receive(1));
		expect(event(s.push(data(1, [3]), receive(2))).status).toBe('closed');
		expect(s.stats().bytes).toBe(0);
		const t = createCotpSession();
		establish(t, configured, configured);
		t.push(data(0, [1], { parameters: [dependency(0)] }), receive(1));
		t.push(release(), receive(2));
		expect(t.stats().bytes).toBe(0);
		t.reset();
		expect(t.stats().frozen).toBe(0);
	});
	it('withholds every truncated dependency header and corrupt EA before changing state', () => {
		const good = data(0, [2], { parameters: [dependency(0)] });
		for (let n = 2; n < good.length; n++) {
			const s = createCotpSession();
			establish(s, configured, configured);
			expect(event(s.push(good.slice(0, n), receive(1))).status).toBe('failed');
			expect(s.stats().bytes).toBe(0);
		}
		const s = createCotpSession();
		establish(s);
		s.push(data(0, [1], { expedited: true }), receive(1));
		const corrupt = ack(0, { expedited: true });
		corrupt[corrupt.length - 1] ^= 1;
		expect(event(s.push(corrupt, receive(2, 'b-to-a'))).status).toBe('failed');
		expect(s.push(data(1, [1], { expedited: true }), receive(3)).assemblies[0].status).toBe('ignored');
	});
});
