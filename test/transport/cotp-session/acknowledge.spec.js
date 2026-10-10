import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { ack, fcc, data, establish, receive, connect, tpdu } from './wire';
const event = (r) => r.events.at(-1);
const sub = (n) => [0x8a, [n >> 8, n & 255]];
describe('passive COTP acknowledgement windows', () => {
	it('reports initial and changed transmit windows without resizing the local receive window', () => {
		const s = createCotpSession();
		establish(s, { credit: 5 }, { credit: 0 });
		expect(s.push(data(), receive(1)).assemblies[0].transmission).toMatchObject({
			withinAdvertisedWindow: false,
			window: { credit: 0 },
			awaitingExpeditedAcknowledgement: false,
		});
		s.push(ack(1, { credit: 2 }), receive(2, 'b-to-a'));
		expect(s.push(data(1), receive(3)).assemblies[0].transmission).toMatchObject({
			withinAdvertisedWindow: true,
			window: { lower: 1, upper: 3, credit: 2 },
		});
	});
	it.each([false, true])('tracks reverse-direction windows with extended=%s', (extended) => {
		const s = createCotpSession();
		establish(s, { extended, credit: 5 }, { extended, credit: 2 });
		s.push(data(0, [7], { extended }), receive(1));
		expect(event(s.push(ack(1, { extended, credit: 4 }), receive(2, 'b-to-a')))).toMatchObject({
			status: 'acknowledged',
			acknowledgement: {
				direction: 'a-to-b',
				service: 'normal',
				sequence: 1,
				window: { lower: 1, upper: 5, credit: 4, subsequence: 0 },
				dataObserved: true,
			},
		});
		expect(event(s.push(ack(0, { extended, reference: 22, credit: 5 }), receive(3)))).toMatchObject({
			status: 'duplicate',
			acknowledgement: { direction: 'b-to-a', window: { credit: 5 } },
		});
	});
	it('reports capture gaps without advancing a receive chain on an ACK', () => {
		const s = createCotpSession();
		establish(s);
		expect(event(s.push(ack(3), receive(1, 'b-to-a'))).acknowledgement.dataObserved).toBe(false);
		expect(s.push(data(3), receive(2)).assemblies[0].status).toBe('pending');
		expect(s.push(data(0), receive(3)).assemblies[0].firstSequence).toBe(0);
	});
	it('orders credit changes by sequence then subsequence then increasing credit', () => {
		const s = createCotpSession();
		establish(s);
		let time = 0;
		const push = (seq, credit, ss) =>
			event(s.push(ack(seq, { credit, parameters: ss === undefined ? [] : [sub(ss)] }), receive(++time, 'b-to-a')));
		expect(push(0, 0, 1)).toMatchObject({
			status: 'acknowledged',
			acknowledgement: { window: { credit: 0, subsequence: 1 } },
		});
		expect(push(0, 3, 0).status).toBe('ignored');
		expect(push(0, 4, 1).status).toBe('acknowledged');
		expect(push(0, 2, 1).status).toBe('ignored');
		expect(push(1, 0, 0).status).toBe('acknowledged');
		expect(push(0, 15, 65535).status).toBe('ignored');
		expect(push(1, 0, 0).status).toBe('duplicate');
	});
	it.each([false, true])('handles sequence wrap and upper-window modulo extended=%s', (extended) => {
		const s = createCotpSession();
		establish(s, { extended }, { extended });
		const modulus = extended ? 2 ** 31 : 128;
		let t = 0;
		for (const seq of [modulus / 2 - 1, modulus - 2, modulus - 1, 0])
			expect(
				event(s.push(ack(seq, { extended, credit: 3 }), receive(++t, 'b-to-a'))).acknowledgement.window.upper,
			).toBe((seq + 3) % modulus);
		expect(event(s.push(ack(modulus - 1, { extended }), receive(t + 1, 'b-to-a'))).status).toBe('ignored');
	});
	it('decodes extended 65535 credit without allocating a transmit-sized buffer', () => {
		const s = createCotpSession();
		establish(s, { extended: true }, { extended: true });
		expect(
			event(s.push(ack(0, { extended: true, credit: 65535 }), receive(1, 'b-to-a'))).acknowledgement.window.credit,
		).toBe(65535);
		expect(s.stats().bytes).toBe(0);
	});
	it.each([false, true])('matches FCC against the opposite retained window extended=%s', (extended) => {
		const s = createCotpSession();
		establish(s, { extended }, { extended });
		s.push(ack(1, { extended, credit: 4, parameters: [sub(1)] }), receive(1, 'b-to-a'));
		const r = event(s.push(ack(0, { extended, reference: 22, parameters: [fcc(1, 1, 4)] }), receive(2)));
		expect(r.acknowledgement.flowControlConfirmed).toBe(true);
		expect(
			event(s.push(ack(0, { extended, reference: 22, parameters: [fcc(1, 1, 3)] }), receive(3))).acknowledgement
				.flowControlConfirmed,
		).toBe(false);
	});
	it('masks insignificant high FCC bits in normal format as specified', () => {
		const s = createCotpSession();
		establish(s);
		expect(
			event(s.push(ack(0, { reference: 22, parameters: [fcc(0x12340000, 0, 0x1233)] }), receive(1))).acknowledgement
				.flowControlConfirmed,
		).toBe(true);
	});
	it.each([
		[0x8a, []],
		[0x8a, [1]],
		[0x8a, [1, 2, 3]],
		[0x8c, []],
		[0x8c, new Uint8Array(7)],
		[0x8c, new Uint8Array(9)],
		[0x8f, [1, 2]],
	])('rejects unsupported/malformed ACK ID %i %j without window mutation', (id, raw) => {
		const s = createCotpSession();
		establish(s);
		expect(event(s.push(ack(2, { parameters: [[id, raw]] }), receive(1, 'b-to-a'))).status).toBe('failed');
		expect(event(s.push(ack(), receive(2, 'b-to-a'))).status).toBe('duplicate');
	});
	it('uses final subsequence/FCC occurrences and retains earlier raw bytes', () => {
		const s = createCotpSession();
		establish(s);
		const r = s.push(
			ack(0, { credit: 0, parameters: [[0x8a, []], sub(1), [0x8c, []], fcc(0, 0, 3)] }),
			receive(1, 'b-to-a'),
		);
		expect(event(r)).toMatchObject({
			status: 'acknowledged',
			acknowledgement: { window: { subsequence: 1 }, flowControlConfirmed: true },
		});
		expect(r.packet.pdus[0].parameters.filter((p) => p.id === 0x8a)).toHaveLength(2);
	});
	it('isolates acknowledgement references, link and direction', () => {
		const s = createCotpSession();
		establish(s);
		for (const reception of [receive(1), receive(2, 'b-to-a', 'other')])
			expect(event(s.push(ack(1), reception)).status).toBe('ignored');
		expect(event(s.push(ack(1, { reference: 12 }), receive(3, 'b-to-a'))).status).toBe('ignored');
		expect(event(s.push(ack(), receive(4, 'b-to-a'))).status).toBe('duplicate');
	});
	it('prechecks every concatenated checksum before updating any window', () => {
		const s = createCotpSession();
		establish(s);
		const first = ack(1);
		const bad = ack(2);
		bad[bad.length - 1] ^= 1;
		expect(event(s.push(Uint8Array.from([...first, ...bad]), receive(1, 'b-to-a'))).status).toBe('failed');
		expect(event(s.push(ack(), receive(2, 'b-to-a'))).status).toBe('duplicate');
	});
	it.each([false, true])('withholds every truncated protected ACK prefix extended=%s', (extended) => {
		const good = ack(1, { extended, parameters: [sub(1), fcc(0, 0, 3)] });
		for (let n = 2; n < good.length; n++) {
			const s = createCotpSession();
			establish(s, { extended }, { extended });
			expect(event(s.push(good.slice(0, n), receive(1, 'b-to-a'))).status).toBe('failed');
			expect(event(s.push(ack(0, { extended }), receive(2, 'b-to-a'))).status).toBe('duplicate');
		}
	});
	it('keeps ACK activity from extending a pending data deadline', () => {
		const s = createCotpSession({ retentionMs: 10 });
		establish(s);
		s.push(data(0, [1], { end: false }), receive(1));
		s.push(ack(), receive(9, 'b-to-a'));
		expect(s.push(ack(), receive(11, 'b-to-a')).discarded).toEqual(['cotp-1']);
	});
	it('copies acknowledgement snapshots and resets generation state', () => {
		const s = createCotpSession();
		establish(s);
		const r = event(s.push(ack(1), receive(1, 'b-to-a')));
		r.acknowledgement.window.lower = 9;
		expect(event(s.push(ack(1), receive(2, 'b-to-a'))).status).toBe('duplicate');
		s.reset();
		establish(s);
		expect(event(s.push(ack(), receive(1, 'b-to-a'))).status).toBe('duplicate');
	});
	it('does not treat an ACK before CC as an established window', () => {
		const s = createCotpSession();
		s.push(connect(), receive());
		expect(event(s.push(ack(1), receive(1, 'b-to-a'))).status).toBe('ignored');
	});
	it('does not mutate state for a checksum-free ACK', () => {
		const s = createCotpSession();
		establish(s);
		expect(event(s.push(tpdu([0x63, 0, 11, 1], [], [], false), receive(1, 'b-to-a'))).status).toBe('failed');
		expect(event(s.push(ack(), receive(2, 'b-to-a'))).status).toBe('duplicate');
	});
});
