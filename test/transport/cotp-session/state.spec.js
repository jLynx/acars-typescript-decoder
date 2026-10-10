import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { connect, data, establish, receive, release, tpdu } from './wire';
const event = (result) => result.events.at(-1);
describe('COTP negotiated connection lifetime and isolation', () => {
	it('suppresses CR/CC duplicates without replacing established data or extending a pending deadline', () => {
		const session = createCotpSession({ retentionMs: 20 });
		establish(session);
		session.push(data(0, [1], { end: false }), receive(1));
		expect(event(session.push(connect(), receive(10))).status).toBe('duplicate');
		expect(event(session.push(connect(0xd0), receive(19, 'b-to-a'))).status).toBe('duplicate');
		expect(session.push(data(1, [2]), receive(20)).assemblies[0].payload).toEqual(Uint8Array.of(1, 2));
	});
	it('does not let duplicate requests extend handshake expiry', () => {
		const session = createCotpSession({ retentionMs: 20 });
		session.push(connect(), receive());
		session.push(connect(), receive(19));
		const result = session.push(connect(0xd0), receive(20, 'b-to-a'));
		expect(result.discarded).toEqual(['cotp-1']);
		expect(event(result).status).toBe('failed');
		expect(session.stats().frozen).toBe(1);
	});
	it.each(['a-to-b', 'b-to-a'])(
		'expires a %s gap while other direction and another connection remain active',
		(direction) => {
			const session = createCotpSession({ retentionMs: 20 });
			establish(session);
			establish(session, { source: 33 }, { source: 44, destination: 33 }, 5);
			session.push(data(1, [1], { reference: direction === 'a-to-b' ? 22 : 11 }), receive(6, direction));
			const other = direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
			session.push(data(0, [2], { reference: other === 'a-to-b' ? 22 : 11 }), receive(19, other));
			session.push(data(0, [4], { reference: 44 }), receive(20));
			const result = session.push(data(1, [3], { reference: 44 }), receive(26));
			expect(result.discarded).toEqual(['cotp-1']);
			expect(result.assemblies[0]).toMatchObject({ status: 'complete', connectionId: 'cotp-2' });
			expect(session.stats()).toMatchObject({ established: 1, frozen: 1 });
		},
	);
	it('does not let expedited delivery or duplicates extend a pending normal message deadline', () => {
		const session = createCotpSession({ retentionMs: 20 });
		establish(session);
		session.push(data(0, [1], { end: false }), receive(1));
		session.push(data(0, [2], { expedited: true }), receive(10));
		session.push(data(0, [2], { expedited: true }), receive(20));
		expect(session.push(data(1, [3]), receive(21)).discarded).toEqual(['cotp-1']);
		expect(session.stats().bytes).toBe(0);
	});
	it('does not create retained expedited gap state from an out-of-sequence ED', () => {
		const session = createCotpSession({ retentionMs: 20 });
		establish(session);
		session.push(data(1, [1], { expedited: true }), receive(1));
		session.push(data(0, [2]), receive(19));
		const result = session.push(data(0, [3], { expedited: true }), receive(21));
		expect(result.discarded).toEqual([]);
		expect(result.assemblies[0].status).toBe('complete');
	});
	it('keeps an idle reverse direction available while the connection remains active', () => {
		const session = createCotpSession({ retentionMs: 20 });
		establish(session);
		session.push(data(0), receive(19));
		expect(session.push(data(0, [2], { reference: 11 }), receive(30, 'b-to-a')).assemblies[0].status).toBe('complete');
	});
	it.each([0x80, 0xc0])(
		'closes both directions on a verified matching release type %i and freezes both peer references',
		(type) => {
			const session = createCotpSession({ freezeMs: 20 });
			establish(session);
			session.push(data(0, [1], { end: false }), receive(1));
			session.push(data(1, [2], { reference: 11 }), receive(2, 'b-to-a'));
			const result = session.push(release(type), receive(3));
			expect(event(result)).toMatchObject({ status: 'closed', connectionId: 'cotp-1' });
			expect(result.discarded).toEqual(['cotp-1']);
			expect(session.stats()).toEqual({ pending: 0, established: 0, frozen: 1, bytes: 0 });
			expect(event(session.push(connect(), receive(4))).reason).toMatch(/quarantined/);
			session.push(connect(0xe0, { source: 33 }), receive(5));
			expect(event(session.push(connect(0xd0, { destination: 33 }), receive(6, 'b-to-a'))).reason).toMatch(
				/quarantined/,
			);
			expect(event(session.push(connect(), receive(23))).status).toBe('requested');
			const established = session.push(connect(0xd0), receive(24, 'b-to-a'));
			expect(event(established)).toMatchObject({ status: 'established', connectionId: 'cotp-3' });
			expect(session.push(data(), receive(25)).assemblies[0].firstSequence).toBe(0);
		},
	);
	it('also closes on a release sent by the responder', () => {
		const session = createCotpSession();
		establish(session);
		expect(event(session.push(release(0x80, { reference: 11, source: 22 }), receive(1, 'b-to-a'))).status).toBe(
			'closed',
		);
	});
	it('withholds a corrupt/mismatched disconnect while retaining valid pending data', () => {
		const session = createCotpSession();
		establish(session);
		session.push(data(0, [1], { end: false }), receive(1));
		const wire = release();
		wire[6] ^= 1;
		expect(event(session.push(wire, receive(2))).status).toBe('failed');
		expect(event(session.push(release(0x80, { source: 33 }), receive(3))).status).toBe('ignored');
		expect(session.push(data(1, [2]), receive(4)).assemblies[0].payload).toEqual(Uint8Array.of(1, 2));
	});
	it('quarantines conflicting verified CR or CC retransmissions and frees both buffers', () => {
		for (const type of [0xe0, 0xd0]) {
			const session = createCotpSession();
			establish(session);
			session.push(data(0, [1], { end: false }), receive(1));
			const result = session.push(connect(type, { credit: 4 }), receive(2, type === 0xe0 ? 'a-to-b' : 'b-to-a'));
			expect(result.discarded).toEqual(['cotp-1']);
			expect(event(result).status).toBe('failed');
			expect(session.stats()).toMatchObject({ established: 0, frozen: 1, bytes: 0 });
		}
	});
	it('closes both directions after a conflicting data retransmission', () => {
		const session = createCotpSession();
		establish(session);
		session.push(data(0, [1], { end: false }), receive(1));
		session.push(data(0, [2], { reference: 11 }), receive(2, 'b-to-a'));
		expect(session.push(data(0, [3], { end: false }), receive(3)).discarded).toEqual(['cotp-1']);
		expect(session.stats().bytes).toBe(0);
		expect(event(session.push(data(1, [4], { reference: 11 }), receive(4, 'b-to-a'))).status).toBe('ignored');
	});
	it('keeps receiver/peer scopes isolated even with identical transport references', () => {
		const session = createCotpSession();
		establish(session);
		establish(session, {}, {}, 1, 'other');
		session.push(data(0, [1], { end: false }), receive(2));
		expect(session.push(data(0, [2]), receive(3, 'a-to-b', 'other')).assemblies[0].payload).toEqual(Uint8Array.of(2));
		session.reset('receiver:peers');
		expect(session.stats().established).toBe(1);
		expect(session.push(data(1, [3]), receive(4, 'a-to-b', 'other')).assemblies[0].status).toBe('complete');
		expect(event(establish(session, {}, {}, 5)).status).toBe('established');
	});
	it('allows identical numeric references at opposite endpoints', () => {
		const session = createCotpSession();
		expect(event(establish(session, { source: 11 }, { source: 11 })).status).toBe('established');
		expect(session.push(data(0, [1], { reference: 11 }), receive(1)).assemblies[0].direction).toBe('a-to-b');
		expect(session.push(data(0, [2], { reference: 11 }), receive(2, 'b-to-a')).assemblies[0].direction).toBe('b-to-a');
	});
	it('refuses a responder reference used by another connection at that peer', () => {
		const session = createCotpSession();
		establish(session);
		session.push(connect(0xe0, { source: 33 }), receive(1));
		expect(event(session.push(connect(0xd0, { destination: 33 }), receive(2, 'b-to-a'))).status).toBe('failed');
		expect(session.stats()).toMatchObject({ established: 1, pending: 1 });
	});
	it('bounds pending, established and frozen records together without evicting quarantine', () => {
		const session = createCotpSession({ maxRecords: 2, freezeMs: 10 });
		establish(session);
		session.push(release(), receive(1));
		session.push(connect(0xe0, { source: 33 }), receive(2));
		expect(event(session.push(connect(0xe0, { source: 55 }), receive(3))).reason).toMatch(/record limit/);
		expect(session.stats()).toMatchObject({ pending: 1, frozen: 1 });
		expect(event(session.push(connect(0xe0, { source: 55 }), receive(11))).status).toBe('requested');
	});
	it.each([{ maxBytes: 2 }, { maxFragments: 1 }])('bounds both directional pending streams with %j', (options) => {
		const session = createCotpSession(options);
		establish(session);
		session.push(data(0, [1, 2], { end: false }), receive(1));
		const result = session.push(data(1, [3]), receive(2));
		expect(result.assemblies[0].status).toBe('failed');
		expect(result.discarded).toEqual(['cotp-1']);
		expect(session.stats().bytes).toBe(0);
	});
	it('retains connection state when corrupt data is retransmitted correctly', () => {
		const session = createCotpSession();
		establish(session);
		const wire = data();
		wire[wire.length - 1] ^= 1;
		expect(event(session.push(wire, receive(1))).status).toBe('failed');
		expect(session.push(data(), receive(2)).assemblies[0].status).toBe('complete');
	});
	it('does not extend idle expiry for unknown acknowledgements or out-of-window data', () => {
		const session = createCotpSession({ retentionMs: 20 });
		establish(session);
		session.push(tpdu([0x60, 0, 22, 0]), receive(10));
		session.push(data(80), receive(19));
		expect(session.push(data(), receive(20)).discarded).toEqual(['cotp-1']);
	});
	it('rejects backwards time without expiring state, including expired reference quarantine', () => {
		const session = createCotpSession({ retentionMs: 20, freezeMs: 10 });
		establish(session);
		session.push(data(), receive(10));
		expect(event(session.push(connect(0xe0, { source: 33 }), receive(9))).reason).toMatch(/backwards/);
		expect(session.stats().pending).toBe(0);
		session.push(release(), receive(11));
		session.push(tpdu([0x60, 0, 22, 0]), receive(21));
		expect(event(session.push(connect(), receive(20))).reason).toMatch(/backwards/);
		expect(event(session.push(connect(), receive(22))).status).toBe('requested');
	});
	it('copies input, returned negotiation, raw headers and delivered data independently of retained state', () => {
		const session = createCotpSession();
		const wire = connect(0xe0, { parameters: [[0xc1, [1]]] });
		const request = session.push(wire, receive());
		wire.fill(0);
		request.packet.pdus[0].rawHeader.fill(0);
		const confirmed = session.push(connect(0xd0, { parameters: [[0xc1, [1]]] }), receive(1, 'b-to-a'));
		event(confirmed).negotiation.callingSelector.fill(2);
		confirmed.packet.pdus[0].rawHeader.fill(0);
		expect(event(session.push(connect(0xd0, { parameters: [[0xc1, [1]]] }), receive(2, 'b-to-a'))).status).toBe(
			'duplicate',
		);
		const result = session.push(data(), receive(3));
		result.assemblies[0].payload.fill(4);
		result.packet.pdus[0].userData.fill(5);
		expect(session.push(data(), receive(4)).assemblies[0].status).toBe('duplicate');
	});
	it('reset removes reference quarantine at a known capture boundary and preserves unique generation IDs', () => {
		const session = createCotpSession();
		establish(session);
		session.push(release(), receive(1));
		session.reset();
		expect(session.stats()).toEqual({ pending: 0, established: 0, frozen: 0, bytes: 0 });
		expect(event(establish(session)).connectionId).toBe('cotp-2');
	});
	it.each(['maxRecords', 'freezeMs', 'retentionMs', 'maxBytes', 'maxFragments', 'windowSize'])(
		'validates %s limits',
		(name) => {
			for (const value of [0, -1, 1.5, Infinity, NaN, 3600001])
				expect(() => createCotpSession({ [name]: value })).toThrow(RangeError);
		},
	);
	it.each([{ link: '' }, { link: 'x\0y' }, { link: 'a'.repeat(201) }, { direction: 'wrong' }, { receivedAt: NaN }])(
		'validates metadata %j',
		(invalid) => {
			expect(() => createCotpSession().push(connect(), { ...receive(), ...invalid })).toThrow(TypeError);
		},
	);
	it.each([new Uint8Array(), new Uint8Array(1), new Uint8Array(8193), []])('bounds complete NSDU input %j', (bytes) => {
		expect(() => createCotpSession().push(bytes, receive())).toThrow(TypeError);
	});
});
