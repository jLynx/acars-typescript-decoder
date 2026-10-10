import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { connect, data, establish, receive, release, tpdu } from './wire';
const event = (result) => result.events.at(-1);
describe('COTP session wire boundaries and integrity edge cases', () => {
	it('accepts retransmitted CR/CC parameters in a different permitted wire order', () => {
		const session = createCotpSession();
		const parameters = [
			[0xc1, [1]],
			[0xc2, [2]],
			[0xc4, [1]],
			[0xc6, [1]],
		];
		establish(session, { parameters }, { parameters });
		session.push(data(0, [1], { end: false }), receive(1));
		expect(event(session.push(connect(0xe0, { parameters: parameters.toReversed() }), receive(2))).status).toBe(
			'duplicate',
		);
		expect(
			event(session.push(connect(0xd0, { parameters: parameters.toReversed() }), receive(3, 'b-to-a'))).status,
		).toBe('duplicate');
		expect(session.push(data(1, [2]), receive(4)).assemblies[0].payload).toEqual(Uint8Array.of(1, 2));
	});
	it('accepts equivalent zero/255 ISO checksum encodings for a retransmitted request', () => {
		let wire;
		for (let value = 0; value < 256; value++) {
			const candidate = connect(0xe0, { payload: [value] });
			if (candidate[9] === 0 || candidate[10] === 0) {
				wire = candidate;
				break;
			}
		}
		expect(wire).toBeDefined();
		const session = createCotpSession();
		session.push(wire, receive());
		const equivalent = wire.slice();
		if (equivalent[9] === 0) equivalent[9] = 255;
		if (equivalent[10] === 0) equivalent[10] = 255;
		expect(event(session.push(equivalent, receive(1))).status).toBe('duplicate');
	});
	it('rejects every truncated CR header boundary without creating state', () => {
		const wire = connect(0xe0, {
			version: 1,
			additional: 1,
			size: 9,
			parameters: [
				[0xc1, [1, 2]],
				[0xc2, [3]],
			],
		});
		for (let length = 2; length < wire.length; length++) {
			const session = createCotpSession();
			const result = session.push(wire.slice(0, length), receive());
			expect(event(result).status, `CR prefix ${length}`).toBe('failed');
			expect(result.packet.raw).toEqual(wire.slice(0, length));
			expect(session.stats().pending).toBe(0);
		}
	});
	it('rejects every truncated CC boundary while retaining a valid request', () => {
		const wire = connect(0xd0, { version: 1, additional: 1, size: 7, parameters: [[0xc2, [3]]] });
		for (let length = 2; length < wire.length; length++) {
			const session = createCotpSession();
			session.push(connect(0xe0, { parameters: [[0xc2, [3]]] }), receive());
			expect(event(session.push(wire.slice(0, length), receive(1, 'b-to-a'))).status, `CC prefix ${length}`).toBe(
				'failed',
			);
			expect(session.stats()).toMatchObject({ pending: 1, established: 0 });
			expect(event(session.push(wire, receive(2, 'b-to-a'))).status).toBe('established');
		}
	});
	it.each([false, true])(
		'rejects every truncated DT boundary for extended=%s without advancing sequences',
		(extended) => {
			const wire = data(0, [1, 2, 3, 4], { extended });
			for (let length = 2; length < wire.length; length++) {
				const session = createCotpSession();
				establish(session, { extended }, { extended });
				const result = session.push(wire.slice(0, length), receive(1));
				expect(event(result).status, `DT prefix ${length}`).toBe('failed');
				expect(session.stats().bytes).toBe(0);
				expect(session.push(wire, receive(2)).assemblies[0].payload).toEqual(Uint8Array.of(1, 2, 3, 4));
			}
		},
	);
	it.each([0x80, 0xc0])('rejects every truncated disconnect boundary for type %i without releasing state', (type) => {
		const wire = release(type);
		for (let length = 2; length < wire.length; length++) {
			const session = createCotpSession();
			establish(session);
			expect(event(session.push(wire.slice(0, length), receive(1))).status).toBe('failed');
			expect(session.stats().established).toBe(1);
			expect(event(session.push(wire, receive(2))).status).toBe('closed');
		}
	});
	it('detects single-bit corruption at every byte of a CR and complete DT', () => {
		for (const original of [connect(0xe0, { payload: [1, 2, 3], version: 1, size: 9 }), data(0, [1, 2, 3])]) {
			for (let offset = 0; offset < original.length; offset++) {
				const session = createCotpSession();
				if (original[1] === 0xf0) establish(session);
				const wire = original.slice();
				wire[offset] ^= 1;
				const result = session.push(wire, receive(1));
				expect(event(result).status, `byte ${offset}`).toBe('failed');
				expect(result.assemblies).toEqual([]);
				expect(session.stats().bytes).toBe(0);
			}
		}
	});
	it('prechecks a corrupt final TPDU before closing a connection named by an earlier valid disconnect', () => {
		const session = createCotpSession();
		establish(session);
		session.push(data(0, [1], { end: false }), receive(1));
		const corrupt = tpdu([0x60, 0, 22, 0]);
		corrupt[corrupt.length - 1] ^= 1;
		const wire = Uint8Array.from([...release(0xc0), ...corrupt]);
		const result = session.push(wire, receive(2));
		expect(event(result).status).toBe('failed');
		expect(result.discarded).toEqual([]);
		expect(session.push(data(1, [2]), receive(3)).assemblies[0].payload).toEqual(Uint8Array.of(1, 2));
	});
	it('associates concatenated acknowledgements followed by data using negotiated extended layouts', () => {
		const session = createCotpSession();
		establish(session, { extended: true }, { extended: true });
		const ack = tpdu([0x60, 0, 22, 0, 0, 0, 0, 0, 1]);
		const wire = Uint8Array.from([...ack, ...data(0, [1], { extended: true })]);
		const result = session.push(wire, receive(1));
		expect(result.packet.pdus.map((pdu) => pdu.format)).toEqual(['extended', 'extended']);
		expect(result.assemblies.map((part) => part.status)).toEqual(['complete']);
		expect(result.events[0]).toMatchObject({ status: 'ignored', connectionId: 'cotp-1' });
	});
	it.each([false, true])('closes a connection for verified invalid expedited data with extended=%s', (extended) => {
		for (const options of [
			{ end: false, length: 1 },
			{ end: true, length: 0 },
			{ end: true, length: 17 },
		]) {
			const session = createCotpSession();
			establish(session, { extended }, { extended });
			session.push(data(0, [1], { end: false, extended }), receive(1));
			const result = session.push(
				data(0, new Uint8Array(options.length), { end: options.end, extended, expedited: true }),
				receive(2),
			);
			expect(result.assemblies[0].status).toBe('failed');
			expect(result.discarded).toEqual(['cotp-1']);
			expect(session.stats().bytes).toBe(0);
		}
	});
	it('rejects checksum-omitted data even when the verified handshake offered omission', () => {
		const session = createCotpSession();
		establish(session, { additional: 3 }, { additional: 1 });
		expect(event(session.push(tpdu([0xf0, 0, 22, 128], [], [1], false), receive(1))).status).toBe('failed');
		expect(session.push(data(), receive(2)).assemblies[0].status).toBe('complete');
	});
	it('validates reserved class-4 option bits even when the checksum verifies', () => {
		for (const option of [1, 4, 8]) {
			const wire = tpdu([0xe0, 0, 0, 0, 11, 0x40 | option]);
			const session = createCotpSession();
			expect(event(session.push(wire, receive())).status).toBe('failed');
			expect(session.stats().pending).toBe(0);
		}
	});
	it('honors minimum receive window and duplicate history bounds', () => {
		const session = createCotpSession({ windowSize: 1 });
		establish(session);
		expect(session.push(data(1), receive(1)).assemblies[0].status).toBe('ignored');
		session.push(data(), receive(2));
		expect(session.push(data(), receive(3)).assemblies[0].status).toBe('duplicate');
		session.push(data(1), receive(4));
		expect(session.stats().bytes).toBe(1);
		expect(session.push(data(), receive(5)).assemblies[0].status).toBe('ignored');
	});
	it('uses sequence wrap across many complete messages in both receive directions', () => {
		const session = createCotpSession();
		establish(session);
		for (let index = 0; index < 260; index++) {
			const direction = index % 2 ? 'b-to-a' : 'a-to-b';
			const reference = direction === 'a-to-b' ? 22 : 11;
			const result = session.push(
				data(Math.floor(index / 2) % 128, [index & 255], { reference }),
				receive(index, direction),
			);
			expect(result.assemblies[0].status).toBe('complete');
			expect(result.assemblies[0].payload).toEqual(Uint8Array.of(index & 255));
		}
		expect(session.stats().bytes).toBe(64);
	});
});
