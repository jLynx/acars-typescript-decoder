import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { connect, data, establish, receive, release, tpdu } from './wire';
const event = (r) => r.events.at(-1);
describe('COTP passive release-handshake evidence', () => {
	it('does not associate a late terminal release with an expired generation', () => {
		const s = createCotpSession({ freezeMs: 10 });
		establish(s);
		s.push(release(), receive(1));
		expect(event(s.push(release(0xc0, { reference: 11, source: 22 }), receive(11, 'b-to-a'))).status).toBe('ignored');
		expect(s.stats().frozen).toBe(0);
	});
	it.each(['a-to-b', 'b-to-a'])('tracks DR followed by reversed DC in direction %s', (direction) => {
		const s = createCotpSession();
		establish(s);
		const reverse = direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
		const refs = direction === 'a-to-b' ? { reference: 22, source: 11 } : { reference: 11, source: 22 };
		s.push(data(0, [1], { end: false }), receive(1));
		expect(event(s.push(release(0x80, refs), receive(2, direction)))).toMatchObject({
			status: 'closed',
			release: { stage: 'requested', direction },
		});
		expect(s.stats().bytes).toBe(0);
		const r = s.push(release(0xc0, { reference: refs.source, source: refs.reference }), receive(3, reverse));
		expect(event(r)).toMatchObject({ status: 'acknowledged', release: { stage: 'confirmed', direction: reverse } });
		expect(r.discarded).toEqual([]);
		expect(s.stats().frozen).toBe(1);
	});
	it('recognizes crossed DRs and matching retransmissions without extending quarantine', () => {
		const s = createCotpSession({ freezeMs: 10 });
		establish(s);
		s.push(release(), receive(1));
		expect(event(s.push(release(0x80, { reference: 11, source: 22 }), receive(2, 'b-to-a'))).release.stage).toBe(
			'crossed',
		);
		expect(event(s.push(release(), receive(9))).status).toBe('duplicate');
		expect(event(s.push(connect(), receive(11))).status).toBe('requested');
	});
	it.each([0, 22])('tracks refusal of a pending CR with responder source %i', (source) => {
		const s = createCotpSession();
		s.push(connect(), receive());
		const wire = tpdu([0x80, 0, 11, source >> 8, source & 255, 1], [], [1]);
		expect(event(s.push(wire, receive(1, 'b-to-a')))).toMatchObject({
			status: 'closed',
			release: { stage: 'refused', reasonCode: 1, userData: Uint8Array.of(1) },
		});
		expect(event(s.push(wire, receive(1, 'b-to-a')))).toMatchObject({
			status: 'duplicate',
			release: { stage: 'refused' },
		});
		expect(s.stats().pending).toBe(0);
		expect(event(s.push(connect(0xd0), receive(2, 'b-to-a'))).status).toBe('failed');
		expect(event(s.push(release(0xc0, { reference: source, source: 11 }), receive(3))).release.stage).toBe('confirmed');
	});
	it('tracks zero-destination cancellation and its zero-source confirmation', () => {
		const s = createCotpSession();
		s.push(connect(), receive());
		expect(event(s.push(release(0x80, { reference: 0, source: 11 }), receive(1))).release.stage).toBe('cancelled');
		expect(event(s.push(release(0xc0, { reference: 11, source: 0 }), receive(2, 'b-to-a'))).release.stage).toBe(
			'confirmed',
		);
	});
	it('reports DC observed without its DR instead of inventing a complete handshake', () => {
		const s = createCotpSession();
		establish(s);
		expect(event(s.push(release(0xc0), receive(1)))).toMatchObject({
			status: 'closed',
			release: { stage: 'unmatched-confirmation' },
		});
	});
	it('does not match wrong directions, link, references or terminal source to a retained DR', () => {
		const s = createCotpSession();
		establish(s);
		s.push(release(), receive(1));
		for (const [wire, reception] of [
			[release(0xc0), receive(2, 'b-to-a')],
			[release(0xc0, { reference: 11, source: 22 }), receive(3)],
			[release(0xc0, { reference: 11, source: 22 }), receive(4, 'b-to-a', 'other')],
			[release(0xc0, { reference: 11, source: 33 }), receive(5, 'b-to-a')],
		])
			expect(event(s.push(wire, reception)).status).toBe('ignored');
		expect(event(s.push(release(0xc0, { reference: 11, source: 22 }), receive(6, 'b-to-a'))).release.stage).toBe(
			'confirmed',
		);
	});
	it('suppresses data after DR and quarantines both references until expiry/reset', () => {
		const s = createCotpSession({ freezeMs: 10 });
		establish(s);
		s.push(release(), receive(1));
		expect(event(s.push(data(), receive(2))).status).toBe('ignored');
		expect(event(s.push(connect(), receive(3))).status).toBe('failed');
		s.reset();
		expect(event(establish(s)).status).toBe('established');
	});
	it.each([64, 65])('validates DR user-data length %i and retains complete bytes', (length) => {
		const s = createCotpSession();
		establish(s);
		const wire = tpdu([0x80, 0, 22, 0, 11, 128], [], new Uint8Array(length));
		const r = s.push(wire, receive(1));
		expect(r.packet.raw).toEqual(wire);
		expect(event(r).status).toBe(length === 64 ? 'closed' : 'failed');
		if (length === 65) expect(s.push(data(), receive(2)).assemblies[0].status).toBe('complete');
	});
	it('checks disconnected packet size against the actual negotiated size', () => {
		const s = createCotpSession();
		establish(s);
		const wire = tpdu([0x80, 0, 22, 0, 11, 0], [[0xe0, new Uint8Array(120)]]);
		expect(event(s.push(wire, receive(1))).status).toBe('failed');
		expect(s.stats().established).toBe(1);
	});
	it('does not rewrite a retained DR when retransmitted reason/data conflict', () => {
		const s = createCotpSession();
		establish(s);
		s.push(release(), receive(1));
		expect(event(s.push(tpdu([0x80, 0, 22, 0, 11, 1]), receive(2))).status).toBe('failed');
		expect(event(s.push(release(0xc0, { reference: 11, source: 22 }), receive(3, 'b-to-a'))).release.stage).toBe(
			'confirmed',
		);
	});
	it('copies release metadata rather than retaining caller buffers', () => {
		const s = createCotpSession();
		establish(s);
		const wire = tpdu([0x80, 0, 22, 0, 11, 0], [], [7]);
		const r = s.push(wire, receive(1));
		event(r).release.userData[0] = 9;
		wire[wire.length - 1] = 8;
		expect(event(s.push(tpdu([0x80, 0, 22, 0, 11, 0], [], [7]), receive(2))).status).toBe('duplicate');
	});
	it.each([0x80, 0xc0])('withholds every truncated release boundary type=%i', (type) => {
		const good = release(type);
		for (let n = 2; n < good.length; n++) {
			const s = createCotpSession();
			establish(s);
			expect(event(s.push(good.slice(0, n), receive(1))).status).toBe('failed');
			expect(s.stats().established).toBe(1);
		}
	});
	it('does not process a valid first DC when a concatenated final checksum fails', () => {
		const s = createCotpSession();
		establish(s);
		const bad = release(0xc0);
		bad[bad.length - 1] ^= 1;
		expect(event(s.push(Uint8Array.from([...release(0xc0), ...bad]), receive(1))).status).toBe('failed');
		expect(s.stats().established).toBe(1);
	});
	it('rejects unsupported release TLVs while leaving valid pending data alone', () => {
		const s = createCotpSession();
		establish(s);
		s.push(data(0, [1], { end: false }), receive(1));
		expect(event(s.push(tpdu([0x80, 0, 22, 0, 11, 0], [[0xfe, [1]]]), receive(2))).status).toBe('failed');
		expect(s.push(data(1, [2]), receive(3)).assemblies[0].payload).toEqual(Uint8Array.of(1, 2));
	});
});
