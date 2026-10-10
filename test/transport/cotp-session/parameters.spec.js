import { describe, expect, it } from 'vitest';
import { createCotpSession, decodeCotp } from '@/framing';
import { connect, data, establish, receive, tpdu } from './wire';
const event = (result) => result.events.at(-1);
describe('RFC 905 COTP duplicate parameter last-occurrence rules', () => {
	it.each([
		[0xc0, [9], [7], { tpduSize: 128 }],
		[0xc0, [7], [9], { tpduSize: 512 }],
		[0xc6, [1], [0], { expedited: false }],
		[0xc6, [0], [1], { expedited: true }],
		[0xc4, [2], [1], { protocolClass: 4 }],
		[0xc0, [], [7], { tpduSize: 128 }],
	])('negotiates using final parameter ID=%i earlier=%j later=%j', (id, earlier, later, expected) => {
		const session = createCotpSession();
		expect(
			event(
				establish(
					session,
					{
						parameters: [
							[id, earlier],
							[id, later],
						],
					},
					{ size: expected.tpduSize === 512 ? 9 : 7, additional: id === 0xc6 ? later[0] : 1 },
				),
			),
		).toMatchObject({ status: 'established', negotiation: expected });
	});
	it.each([
		[0xc0, [7], [6]],
		[0xc4, [1], [2]],
		[0xc6, [1], [1, 16]],
		[0xc6, [1], []],
		[0xc7, [0x20], [0x41]],
	])('rejects an invalid effective parameter ID=%i', (id, earlier, later) => {
		const session = createCotpSession();
		const result = session.push(
			connect(0xe0, {
				parameters: [
					[id, earlier],
					[id, later],
				],
			}),
			receive(),
		);
		expect(event(result).status).toBe('failed');
		expect(session.stats().pending).toBe(0);
	});
	it('uses last selectors for echo matching and keeps all earlier raw values', () => {
		const session = createCotpSession();
		const requested = session.push(
			connect(0xe0, {
				parameters: [
					[0xc1, [9]],
					[0xc1, [1]],
					[0xc2, [8]],
					[0xc2, [2]],
				],
			}),
			receive(),
		);
		expect(requested.packet.pdus[0].parameters.filter((p) => p.id === 0xc1).map((p) => [...p.raw])).toEqual([[9], [1]]);
		const result = session.push(
			connect(0xd0, {
				parameters: [
					[0xc1, [7]],
					[0xc1, [1]],
					[0xc2, [6]],
					[0xc2, [2]],
				],
			}),
			receive(1, 'b-to-a'),
		);
		expect(event(result)).toMatchObject({
			status: 'established',
			negotiation: { callingSelector: Uint8Array.of(1), calledSelector: Uint8Array.of(2) },
		});
	});
	it('checks final CC options against the request instead of an earlier matching occurrence', () => {
		const session = createCotpSession();
		expect(
			event(
				establish(
					session,
					{ additional: 0 },
					{
						parameters: [
							[0xc6, [0]],
							[0xc6, [1]],
						],
					},
				),
			).status,
		).toBe('failed');
		expect(session.stats().pending).toBe(1);
	});
	it('normalizes duplicate effective parameters for CR and CC retransmission comparison', () => {
		const session = createCotpSession();
		establish(
			session,
			{
				parameters: [
					[0xc0, [8]],
					[0xc0, [9]],
				],
			},
			{
				parameters: [
					[0xc0, [8]],
					[0xc0, [9]],
				],
			},
		);
		session.push(data(0, [1], { end: false }), receive(1));
		expect(event(session.push(connect(0xe0, { size: 9 }), receive(2))).status).toBe('duplicate');
		expect(event(session.push(connect(0xd0, { size: 9 }), receive(3, 'b-to-a'))).status).toBe('duplicate');
		expect(session.push(data(1, [2]), receive(4)).assemblies[0].payload).toEqual(Uint8Array.of(1, 2));
	});
	it('rejects conflicting effective duplicate values for established retransmissions', () => {
		const session = createCotpSession();
		establish(session, { size: 9 }, { size: 9 });
		const result = session.push(
			connect(0xe0, {
				parameters: [
					[0xc0, [9]],
					[0xc0, [8]],
				],
			}),
			receive(1),
		);
		expect(event(result).status).toBe('failed');
		expect(result.discarded).toEqual(['cotp-1']);
	});
	it('uses the final valid checksum occurrence while checking every protected byte', () => {
		const wire = tpdu([0xf0, 0, 22, 128], [[0xc3, [5]]], [1]);
		const result = decodeCotp(wire, { format: 'normal' });
		expect(result.integrity).toBe('verified');
		expect(result.pdus[0].parameters.filter((p) => p.id === 0xc3).map((p) => p.raw.length)).toEqual([1, 2]);
		const session = createCotpSession();
		establish(session);
		expect(session.push(wire, receive(1)).assemblies[0].payload).toEqual(Uint8Array.of(1));
		const corrupt = wire.slice();
		corrupt[7] ^= 1;
		expect(decodeCotp(corrupt, { format: 'normal' }).integrity).toBe('failed');
	});
	it('withholds integrity when a later checksum has an invalid length even if the earlier one solves the equations', () => {
		const good = tpdu([0xf0, 0, 22, 128], [[0xc3, [5]]], [1]);
		const params = [
			[0xc3, [...good.slice(10, 12)]],
			[0xc3, [5]],
		];
		const wire = tpdu([0xf0, 0, 22, 128], params, [1], false);
		// Zeroing and solving earlier checksum octets makes the whole Fletcher residue zero.
		wire[7] = wire[8] = 0;
		let sum = 0,
			weighted = 0;
		for (const byte of wire) {
			sum = (sum + byte) % 255;
			weighted = (weighted + sum) % 255;
		}
		wire[7] = ((wire.length - 8) * sum - weighted + 255 * 256) % 255;
		wire[8] = (-sum - wire[7] + 510) % 255;
		expect(decodeCotp(wire, { format: 'normal' }).integrity).toBe('failed');
		const session = createCotpSession();
		establish(session);
		expect(event(session.push(wire, receive(1))).status).toBe('failed');
		expect(session.stats().bytes).toBe(0);
	});
	it('retains unsupported duplicate options as raw and does not establish the connection', () => {
		const session = createCotpSession();
		const result = session.push(
			connect(0xe0, {
				parameters: [
					[0xfe, [1]],
					[0xfe, [2]],
				],
			}),
			receive(),
		);
		expect(event(result).status).toBe('failed');
		expect(result.packet.pdus[0].parameters.filter((p) => p.id === 0xfe).map((p) => [...p.raw])).toEqual([[1], [2]]);
	});
	it('rejects a truncated final duplicate occurrence rather than falling back to an earlier complete one', () => {
		const wire = Uint8Array.of(12, 0xe0, 0, 0, 0, 11, 0x40, 0xc6, 1, 1, 0xc6, 2, 0);
		const packet = decodeCotp(wire);
		expect(packet.pdus).toEqual([]);
		expect(packet.unconsumed).toEqual(wire);
	});
});
