import { describe, expect, it } from 'vitest';
import { createCotpSession, decodeCotp } from '@/framing';
import { connect, data, establish, receive, tpdu } from './wire';

const event = (result) => result.events.at(-1);
describe('passive class-4 COTP CR/CC negotiation', () => {
	it('matches a reversed confirmation and starts both sequence spaces at zero', () => {
		const session = createCotpSession();
		expect(event(session.push(connect(), receive()))).toMatchObject({ status: 'requested', connectionId: 'cotp-1' });
		expect(session.stats()).toEqual({ pending: 1, established: 0, frozen: 0, bytes: 0 });
		expect(event(session.push(connect(0xd0), receive(1, 'b-to-a')))).toMatchObject({
			status: 'established',
			negotiation: {
				protocolClass: 4,
				format: 'normal',
				tpduSize: 128,
				expedited: true,
				checksum: 'required',
				initiatorCredit: 3,
				responderCredit: 3,
			},
		});
		expect(session.push(data(0, [1]), receive(2)).assemblies[0]).toMatchObject({
			status: 'complete',
			connectionId: 'cotp-1',
			direction: 'a-to-b',
			payload: Uint8Array.of(1),
		});
		expect(session.push(data(0, [2], { reference: 11 }), receive(3, 'b-to-a')).assemblies[0]).toMatchObject({
			status: 'complete',
			direction: 'b-to-a',
			payload: Uint8Array.of(2),
		});
	});
	it('also establishes a connection requested by peer B', () => {
		const session = createCotpSession();
		expect(event(establish(session, {}, {}, 0, 'other', 'b-to-a')).status).toBe('established');
		expect(session.push(data(), receive(1, 'b-to-a', 'other')).assemblies[0].status).toBe('complete');
	});
	it.each([
		['normal', false],
		['extended', true],
	])('uses negotiated %s layout, not header parity', (format, extended) => {
		const session = createCotpSession();
		expect(
			event(establish(session, { extended, size: 10, additional: 1 }, { extended, size: 9, additional: 1 }))
				.negotiation,
		).toMatchObject({ format, tpduSize: 512 });
		session.push(data(1, [2], { extended }), receive(1));
		expect(session.push(data(0, [1], { extended }), receive(2)).assemblies.map((part) => [...part.payload])).toEqual([
			[1],
			[2],
		]);
		expect(session.push(data(0, [3], { extended, expedited: true }), receive(3)).assemblies[0]).toMatchObject({
			service: 'expedited',
			firstSequence: 0,
		});
	});
	it('allows the responder to decline extended format, expedited service and checksum omission', () => {
		const session = createCotpSession();
		expect(event(establish(session, { extended: true, additional: 3 }, { additional: 0 })).negotiation).toMatchObject({
			format: 'normal',
			expedited: false,
		});
		expect(session.push(data(0, [3], { expedited: true }), receive(1)).assemblies[0].status).toBe('ignored');
		expect(session.push(data(), receive(2)).assemblies[0].status).toBe('complete');
	});
	it.each([
		[{ size: 7 }, { size: 8 }],
		[{ extended: false }, { extended: true }],
		[{ additional: 0 }, { additional: 1 }],
		[{ additional: 1 }, { additional: 2 }],
		[{ parameters: [[0xc1, [1]]] }, { parameters: [[0xc1, [2]]] }],
		[{ parameters: [[0xc2, [1]]] }, { parameters: [[0xc2, [2]]] }],
		[{}, { protocolClass: 2 }],
		[{}, { source: 0 }],
		[{}, { payload: new Uint8Array(33) }],
		[{}, { parameters: [[0xc1, new Uint8Array(120)]] }],
	])('rejects invalid selection %j / %j while retaining the request', (request, confirmation) => {
		const session = createCotpSession();
		expect(event(establish(session, request, confirmation)).status).toBe('failed');
		expect(session.stats().pending).toBe(1);
		expect(session.stats().established).toBe(0);
	});
	it.each([
		{ source: 0 },
		{ destination: 1 },
		{ protocolClass: 0 },
		{ protocolClass: 2 },
		{ size: 6 },
		{ size: 14 },
		{ version: 0 },
		{ version: 2 },
		{ parameters: [[0xc6, []]] },
		{ parameters: [[0xc0, [7, 8]]] },
		{ parameters: [[0xc4, []]] },
		{ parameters: [[0xc6, [0, 1]]] },
		{ parameters: [[0xc7, [0x41]]] },
		{ parameters: [[0xc7, []]] },
		{ parameters: [[0xf0, [0]]] },
		{ parameters: [[8, [1, 2]]] },
		{ parameters: [[0xfe, [1]]] },
		{ payload: new Uint8Array(33) },
		{ parameters: [[0xc1, new Uint8Array(120)]] },
		{ checksum: false },
	])('preserves unsupported or malformed request %j without opening state', (options) => {
		const session = createCotpSession();
		const wire = connect(0xe0, options);
		const result = session.push(wire, receive());
		expect(event(result).status).toBe('failed');
		expect(result.packet.raw).toEqual(wire);
		expect(session.stats()).toEqual({ pending: 0, established: 0, frozen: 0, bytes: 0 });
	});
	it('accepts class-4 selection when the request also offered alternative classes', () => {
		expect(event(establish(createCotpSession(), { parameters: [[0xc7, [0x20]]] })).status).toBe('established');
	});
	it('keeps the maximum 32-byte connect user data separate from subsequent data messages', () => {
		const session = createCotpSession();
		const payload = new Uint8Array(32).fill(1);
		const result = establish(session, { payload }, { payload });
		expect(event(result).status).toBe('established');
		expect(result.packet.pdus[0].userData).toEqual(payload);
		expect(result.assemblies).toEqual([]);
		expect(session.push(data(), receive(1)).assemblies[0].payload).toEqual(Uint8Array.of(7));
	});
	it('copies negotiated selectors and accepts omitted CC selector echoes', () => {
		const session = createCotpSession();
		const result = establish(session, {
			parameters: [
				[0xc1, [1]],
				[0xc2, [2]],
			],
		});
		expect(event(result).negotiation).toMatchObject({
			callingSelector: Uint8Array.of(1),
			calledSelector: Uint8Array.of(2),
		});
	});
	it('retains duplicate parameter TLVs and uses their last occurrence', () => {
		const session = createCotpSession();
		const result = session.push(
			connect(0xe0, {
				parameters: [
					[0xc6, [1]],
					[0xc6, [1]],
				],
			}),
			receive(),
		);
		expect(event(result).status).toBe('requested');
		expect(session.stats().pending).toBe(1);
		expect(result.packet.pdus[0].parameters.filter((part) => part.id === 0xc6)).toHaveLength(2);
	});
	it.each([128, 8192])('enforces the negotiated %i-byte TPDU size', (size) => {
		const session = createCotpSession();
		const exponent = Math.log2(size);
		establish(session, { size: exponent }, { size: exponent });
		// Normal DT LI + fixed header + checksum TLV is nine bytes.
		expect(session.push(data(0, new Uint8Array(size - 9)), receive(1)).assemblies[0].payload).toHaveLength(size - 9);
		if (size === 128) {
			expect(event(session.push(data(1, new Uint8Array(size - 8)), receive(2))).status).toBe('failed');
			expect(session.push(data(1, [4]), receive(3)).assemblies[0].status).toBe('complete');
		}
	});
	it('distinguishes version C4, additional options C6 and alternative classes C7', () => {
		const packet = decodeCotp(connect(0xe0, { version: 1, additional: 0, parameters: [[0xc7, [0x20]]] }));
		expect(packet.pdus[0].parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 0xc4, name: 'Version number', value: 1 }),
				expect.objectContaining({ id: 0xc6, name: 'Additional options', value: 0 }),
				expect.objectContaining({ id: 0xc7, name: 'Alternative protocol classes', raw: Uint8Array.of(0x20) }),
			]),
		);
	});
	it('requires matching link, direction and destination reference before confirmation', () => {
		const session = createCotpSession();
		session.push(connect(), receive());
		for (const reception of [receive(1), receive(2, 'b-to-a', 'other')])
			expect(event(session.push(connect(0xd0), reception)).status).toBe('failed');
		expect(event(session.push(connect(0xd0, { destination: 12 }), receive(3, 'b-to-a'))).status).toBe('failed');
		expect(event(session.push(connect(0xd0), receive(4, 'b-to-a'))).status).toBe('established');
	});
	it('requires a complete handshake before accepting data, including a missing CR', () => {
		const session = createCotpSession();
		expect(event(session.push(connect(0xd0), receive(0, 'b-to-a'))).status).toBe('failed');
		session.push(connect(), receive(1));
		expect(event(session.push(data(), receive(2))).status).toBe('ignored');
		expect(session.stats().bytes).toBe(0);
	});
	it('rejects a malformed concatenated control NSDU without handling an earlier valid CR', () => {
		const session = createCotpSession();
		const ack = tpdu([0x60, 0, 22, 0]);
		const wire = Uint8Array.from([...ack, ...connect().slice(0, -1)]);
		expect(event(session.push(wire, receive())).status).toBe('failed');
		expect(session.stats().pending).toBe(0);
	});
	it('validates every checksum before mutating a concatenated NSDU', () => {
		const session = createCotpSession();
		const ack = tpdu([0x60, 0, 22, 0]);
		ack[4] ^= 1;
		expect(event(session.push(Uint8Array.from([...ack, ...connect()]), receive())).status).toBe('failed');
		expect(session.stats().pending).toBe(0);
	});
});
