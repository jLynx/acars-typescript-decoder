import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { connect, data, establish, receive } from './wire';
const event = (r) => r.events.at(-1);
const times = (a, i) => ({
	parameters: [...(a === undefined ? [] : [[0x85, a]]), ...(i === undefined ? [] : [[0xf2, i]])],
});
describe('COTP per-peer timing and ROA negotiation', () => {
	it.each([
		[0, [0, 0]],
		[65535, [255, 255]],
		[258, [1, 2]],
	])('retains acknowledgement %i milliseconds', (value, raw) => {
		const s = createCotpSession();
		const r = establish(s, times(raw, [255, 255, 255, 255]), times([0, 3], [0, 0, 0, 0]));
		expect(event(r)).toMatchObject({
			status: 'established',
			negotiation: {
				initiatorTiming: { acknowledgementMs: value, inactivityMs: 4294967295 },
				responderTiming: { acknowledgementMs: 3, inactivityMs: 0 },
			},
		});
	});
	it('allows independent ACK indications and an omitted CC inactivity indication', () => {
		expect(event(establish(createCotpSession(), {}, times([1, 0]))).negotiation.responderTiming.acknowledgementMs).toBe(
			256,
		);
		expect(event(establish(createCotpSession(), times(undefined, [0, 0, 0, 1]))).status).toBe('established');
	});
	it('rejects unsolicited CC inactivity without replacing the request', () => {
		const s = createCotpSession();
		expect(event(establish(s, {}, times(undefined, [0, 0, 0, 1]))).status).toBe('failed');
		expect(event(s.push(connect(0xd0), receive(1, 'b-to-a'))).status).toBe('established');
	});
	it.each([
		[0x85, []],
		[0x85, [1]],
		[0x85, [1, 2, 3]],
		[0xf2, []],
		[0xf2, [1, 2, 3]],
		[0xf2, [1, 2, 3, 4, 5]],
	])('rejects timing length ID %i %j', (id, raw) => {
		for (const type of [0xe0, 0xd0]) {
			const s = createCotpSession();
			if (type === 0xd0) s.push(connect(0xe0, times(undefined, [0, 0, 0, 1])), receive());
			const r = s.push(connect(type, { parameters: [[id, raw]] }), receive(1, type === 0xe0 ? 'a-to-b' : 'b-to-a'));
			expect(event(r).status).toBe('failed');
			expect(s.stats().established).toBe(0);
		}
	});
	it.each([0x85, 0xf2])('uses final timing parameter %i and preserves both raw occurrences', (id) => {
		const valid = id === 0x85 ? [1, 2] : [1, 2, 3, 4];
		const s = createCotpSession();
		const opts = {
			parameters: [
				[id, []],
				[id, valid],
			],
		};
		const r = establish(s, opts, opts);
		expect(event(r).status).toBe('established');
		expect(r.packet.pdus[0].parameters.filter((p) => p.id === id)).toHaveLength(2);
	});
	it('keeps negotiated timings separate from bounded capture expiry', () => {
		const s = createCotpSession({ retentionMs: 10 });
		establish(s, times([255, 255], [255, 255, 255, 255]), times([255, 255], [255, 255, 255, 255]));
		expect(s.push(data(), receive(10)).discarded).toEqual(['cotp-1']);
	});
	it.each([
		[0x21, 0x21, true],
		[0x21, 1, false],
		[0xa1, 0xa1, true],
		[0xc1, 0xc1, false],
		[0x41, 0x41, false],
	])('selects options %i / %i', (a, b, roa) => {
		const r = establish(createCotpSession(), { additional: a }, { additional: b });
		expect(event(r)).toMatchObject({ status: 'established', negotiation: { requestAcknowledgement: roa } });
	});
	it.each([
		[1, 0x21],
		[0x41, 0x40],
		[1, 0x41],
	])('rejects unoffered or inconsistent options %i / %i', (a, b) =>
		expect(event(establish(createCotpSession(), { additional: a }, { additional: b })).status).toBe('failed'),
	);
	it('accepts ROA only after negotiation and preserves a valid subsequent sequence', () => {
		const s = createCotpSession();
		establish(s);
		expect(event(s.push(data(0, [1], { requestAck: true }), receive(1))).status).toBe('failed');
		expect(s.push(data(0), receive(2)).assemblies[0].status).toBe('complete');
		const t = createCotpSession();
		establish(t, { additional: 0x21 }, { additional: 0x21 });
		expect(t.push(data(0, [1], { requestAck: true }), receive(1)).assemblies[0].status).toBe('complete');
	});
	it('withholds corrupt and truncated timing-bearing requests', () => {
		const good = connect(0xe0, times([1, 2], [1, 2, 3, 4]));
		for (let n = 2; n < good.length; n++) {
			const s = createCotpSession();
			expect(event(s.push(good.slice(0, n), receive())).status).toBe('failed');
		}
		const bad = good.slice();
		bad[9] ^= 1;
		const s = createCotpSession();
		expect(event(s.push(bad, receive())).status).toBe('failed');
		expect(s.stats().pending).toBe(0);
	});
});
