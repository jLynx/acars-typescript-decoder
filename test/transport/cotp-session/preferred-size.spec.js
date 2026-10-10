import { describe, expect, it } from 'vitest';
import { createCotpSession, decodeCotp } from '@/framing';
import { connect, data, establish, receive, release, tpdu } from './wire';

const event = (result) => result.events.at(-1);
const preferred = (value, extra = {}) => ({ parameters: [[0xf0, value]], ...extra });
const values = [
	[[1], 128],
	[[3], 384],
	[[63], 8064],
	[[64], 8192],
	[[65], 8320],
	[[255], 32640],
	[[1, 0], 32768],
	[[0, 3], 384],
	[[1, 2, 3], 8454528],
	[[0, 0, 3], 384],
	[[1, 2, 3, 4], 2164359680],
	[[0, 0, 0, 3], 384],
	[[255, 255, 255, 255], 549755813760],
];
const invalid = [[], [0], [0, 0], [0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0, 1]];

describe('X.224 preferred maximum TPDU size', () => {
	it.each(values)('reads unsigned big-endian %j as %i bytes and selects it independently of C0', (raw, size) => {
		const wire = connect(0xe0, preferred(raw, { size: 7 }));
		const packet = decodeCotp(wire);
		expect(packet).toMatchObject({ coverage: 'headers', integrity: 'verified', raw: wire });
		expect(packet.pdus[0].parameters.find((part) => part.id === 0xf0)).toEqual({
			id: 0xf0,
			name: 'Preferred maximum TPDU size',
			raw: Uint8Array.from(raw),
			value: size,
			unit: 'bytes',
		});
		const session = createCotpSession();
		expect(event(establish(session, preferred(raw, { size: 7 }), preferred(raw)))).toMatchObject({
			status: 'established',
			negotiation: { tpduSize: size },
		});
		expect(session.push(data(), receive(1)).assemblies[0].status).toBe('complete');
	});
	it.each([
		[preferred([8], { size: 7 }), preferred([3]), 384],
		[preferred([2], { size: 13 }), preferred([1]), 128],
		[preferred([1], { size: 10 }), { size: 9 }, 512],
		[preferred([8], { size: 9 }), {}, 128],
		[preferred([8]), {}, 128],
		[preferred([255, 255, 255, 255], { size: 13 }), { size: 13 }, 8192],
	])('allows either preferred selection or independent ordinary fallback %j / %j', (request, confirm, size) => {
		expect(event(establish(createCotpSession(), request, confirm))).toMatchObject({
			status: 'established',
			negotiation: { tpduSize: size },
		});
	});
	it.each([
		[{}, preferred([1])],
		[{ size: 13 }, preferred([64])],
		[preferred([3]), preferred([4])],
		[preferred([1, 0]), preferred([1, 1])],
		[preferred([8]), preferred([3], { size: 7 })],
		[preferred([8]), preferred([3], { size: 13 })],
		[preferred([8]), { size: 8 }],
		[preferred([8], { size: 8 }), { size: 9 }],
	])('rejects a size not offered or mutually exclusive CC parameters %j / %j', (request, confirm) => {
		const session = createCotpSession();
		const result = establish(session, request, confirm);
		expect(event(result).status).toBe('failed');
		expect(result.packet.raw).toEqual(connect(0xd0, confirm));
		expect(session.stats()).toMatchObject({ pending: 1, established: 0, bytes: 0 });
		// A rejected confirmation must not replace the retained valid offer.
		expect(event(session.push(connect(0xd0), receive(1, 'b-to-a'))).status).toBe('established');
	});
	it.each(invalid.map((raw) => [raw]))('retains invalid value %j without inventing a size or opening state', (raw) => {
		const wire = connect(0xe0, preferred(raw));
		const session = createCotpSession();
		const result = session.push(wire, receive());
		expect(result.packet.raw).toEqual(wire);
		const part = result.packet.pdus[0].parameters.find((part) => part.id === 0xf0);
		expect(part.raw).toEqual(Uint8Array.from(raw));
		expect(part.value).toBeUndefined();
		expect(part.unit).toBeUndefined();
		expect(event(result)).toMatchObject({ status: 'failed', reason: 'Invalid preferred maximum TPDU size.' });
		expect(session.stats().pending).toBe(0);
	});
	it.each(invalid.map((raw) => [raw]))('rejects malformed CC preferred value %j without consuming the CR', (raw) => {
		const session = createCotpSession();
		expect(event(establish(session, preferred([64]), preferred(raw))).status).toBe('failed');
		expect(session.stats().pending).toBe(1);
		expect(event(session.push(connect(0xd0, preferred([3])), receive(1, 'b-to-a'))).status).toBe('established');
	});
	it.each([
		[[], [3]],
		[[0], [3]],
		[[4], [3]],
	])('uses the last preferred value in CR and CC while retaining earlier %j', (earlier, last) => {
		const session = createCotpSession();
		const duplicate = {
			parameters: [
				[0xf0, earlier],
				[0xf0, last],
			],
		};
		const result = establish(session, duplicate, duplicate);
		expect(event(result)).toMatchObject({ status: 'established', negotiation: { tpduSize: 384 } });
		expect(result.packet.pdus[0].parameters.filter((p) => p.id === 0xf0).map((p) => [...p.raw])).toEqual([
			earlier,
			last,
		]);
	});
	it.each([0xe0, 0xd0])('never falls back to an earlier preferred value in TPDU %i', (type) => {
		const session = createCotpSession();
		if (type === 0xd0) session.push(connect(0xe0, preferred([64])), receive());
		const result = session.push(
			connect(type, {
				parameters: [
					[0xf0, [3]],
					[0xf0, [0]],
				],
			}),
			receive(1, type === 0xe0 ? 'a-to-b' : 'b-to-a'),
		);
		expect(event(result).status).toBe('failed');
		expect(session.stats().established).toBe(0);
	});
	it('compares effective duplicate values on request and confirmation retransmissions', () => {
		const session = createCotpSession();
		session.push(
			connect(0xe0, {
				parameters: [
					[0xf0, [0]],
					[0xf0, [3]],
				],
			}),
			receive(),
		);
		expect(event(session.push(connect(0xe0, preferred([3])), receive(1))).status).toBe('duplicate');
		session.push(connect(0xd0, preferred([3])), receive(2, 'b-to-a'));
		expect(
			event(
				session.push(
					connect(0xd0, {
						parameters: [
							[0xf0, [9]],
							[0xf0, [3]],
						],
					}),
					receive(3, 'b-to-a'),
				),
			).status,
		).toBe('duplicate');
		expect(event(session.push(connect(0xd0, preferred([2])), receive(4, 'b-to-a'))).status).toBe('failed');
		expect(session.stats()).toMatchObject({ established: 0, frozen: 1 });
	});
	it.each(['a-to-b', 'b-to-a'])('keeps preferred-size matching within the peer direction and link: %s', (direction) => {
		const session = createCotpSession();
		const opposite = direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
		session.push(connect(0xe0, preferred([3])), receive(0, direction));
		expect(event(session.push(connect(0xd0, preferred([3])), receive(1, direction))).status).toBe('failed');
		expect(event(session.push(connect(0xd0, preferred([3])), receive(2, opposite, 'other'))).status).toBe('failed');
		expect(event(session.push(connect(0xd0, preferred([3])), receive(3, opposite))).negotiation.tpduSize).toBe(384);
	});
	it.each([
		[128, [1]],
		[384, [3]],
		[8064, [63]],
		[8192, [64]],
	])('enforces selected %i bytes including LI, fixed header and checksum in both directions', (size, raw) => {
		const session = createCotpSession();
		establish(session, preferred(raw), preferred(raw));
		for (const [index, direction, reference] of [
			[1, 'a-to-b', 22],
			[2, 'b-to-a', 11],
		]) {
			const wire = data(0, new Uint8Array(size - 9), { reference });
			expect(wire).toHaveLength(size);
			expect(session.push(wire, receive(index, direction)).assemblies[0].payload).toHaveLength(size - 9);
		}
		if (size < 8192) {
			expect(event(session.push(data(1, new Uint8Array(size - 8)), receive(3))).status).toBe('failed');
			expect(session.push(data(1), receive(4)).assemblies[0].status).toBe('complete');
		}
	});
	it('retains a large negotiated size without lifting the local 8192-byte input bound', () => {
		const session = createCotpSession();
		expect(event(establish(session, preferred([255, 255, 255, 255]), preferred([1, 0]))).negotiation.tpduSize).toBe(
			32768,
		);
		expect(session.push(data(0, new Uint8Array(8192 - 9)), receive(1)).assemblies[0].status).toBe('complete');
		const oversize = data(1, new Uint8Array(8192 - 8));
		expect(decodeCotp(oversize)).toBeUndefined();
		expect(() => session.push(oversize, receive(2))).toThrow('Invalid COTP session NSDU');
		expect(session.push(data(1), receive(3)).assemblies[0].status).toBe('complete');
	});
	it('enforces extended-format overhead for a non-power-of-two selection', () => {
		const session = createCotpSession();
		establish(session, preferred([3], { extended: true }), preferred([3], { extended: true }));
		expect(session.push(data(0, new Uint8Array(384 - 12), { extended: true }), receive(1)).assemblies[0].status).toBe(
			'complete',
		);
		expect(event(session.push(data(1, new Uint8Array(384 - 11), { extended: true }), receive(2))).status).toBe(
			'failed',
		);
	});
	it('checks the checksum over superseded preferred values as well as the effective value', () => {
		const session = createCotpSession();
		const wire = connect(0xe0, {
			parameters: [
				[0xf0, [8]],
				[0xf0, [3]],
			],
		});
		wire[9] ^= 1;
		const result = session.push(wire, receive());
		expect(result.packet.integrity).toBe('failed');
		expect(event(result).status).toBe('failed');
		expect(session.stats().pending).toBe(0);
	});
	it('does not process any truncated prefix of a protected preferred-size request', () => {
		const wire = connect(0xe0, preferred([1, 2, 3, 4]));
		for (let length = 2; length < wire.length; length++) {
			const session = createCotpSession();
			expect(event(session.push(wire.slice(0, length), receive())).status).toBe('failed');
			expect(session.stats().pending).toBe(0);
		}
	});
	it('retains a truncated preferred TLV instead of reusing an earlier complete occurrence', () => {
		// The final TLV declares five bytes but only four remain in the header.
		const wire = tpdu([0xe0, 0, 0, 0, 11, 0x40], [[0xf0, [3]]], [], false);
		const truncated = Uint8Array.from([...wire, 0xf0, 5, 0xc3, 2, 0, 0]);
		truncated[0] += 6;
		const session = createCotpSession();
		const result = session.push(truncated, receive());
		expect(result.packet.raw).toEqual(truncated);
		expect(event(result).status).toBe('failed');
		expect(session.stats().pending).toBe(0);
	});
	it.each([0xe0, 0xd0])('rejects missing or corrupt checksums on preferred negotiation TPDU %i', (type) => {
		for (const checksum of [false, true]) {
			const session = createCotpSession();
			if (type === 0xd0) session.push(connect(0xe0, preferred([3])), receive());
			const wire = connect(type, preferred([3], { checksum }));
			if (checksum) wire[9] ^= 1;
			const result = session.push(wire, receive(1, type === 0xe0 ? 'a-to-b' : 'b-to-a'));
			expect(event(result).status).toBe('failed');
			expect(session.stats().established).toBe(0);
		}
	});
	it('keeps the 128-byte CR limit even when proposing a much larger preferred size', () => {
		for (const [selectorLength, expected] of [
			[112, 'requested'],
			[113, 'failed'],
		]) {
			const session = createCotpSession();
			const wire = connect(0xe0, {
				parameters: [
					[0xf0, [3]],
					[0xc1, new Uint8Array(selectorLength)],
				],
			});
			expect(wire).toHaveLength(selectorLength + 16);
			expect(event(session.push(wire, receive())).status).toBe(expected);
		}
	});
	it('checks CC length against the preferred selection instead of the ignored C0 default', () => {
		const selector = new Uint8Array(111);
		const request = {
			parameters: [
				[0xf0, [3]],
				[0xc1, selector],
			],
		};
		const session = createCotpSession();
		const cc = {
			parameters: [
				[0xf0, [3]],
				[0xc1, selector],
				[0xc2, new Uint8Array(100)],
			],
		};
		expect(connect(0xd0, cc)).toHaveLength(229);
		expect(event(establish(session, request, cc)).status).toBe('established');
		const smaller = createCotpSession();
		expect(
			event(establish(smaller, request, { ...cc, parameters: [[0xf0, [1]], ...cc.parameters.slice(1)] })).status,
		).toBe('failed');
	});
	it('does not let a large preferred size bypass the configured assembly byte bound', () => {
		const session = createCotpSession({ maxBytes: 16 });
		establish(session, preferred([255, 255, 255, 255]), preferred([255, 255, 255, 255]));
		expect(session.push(data(0, new Uint8Array(10), { end: false }), receive(1)).assemblies[0].status).toBe('pending');
		expect(event(session.push(data(1, new Uint8Array(7)), receive(2))).status).toBe('closed');
		expect(session.stats()).toMatchObject({ established: 0, frozen: 1, bytes: 0 });
	});
	it('does not let effective duplicate offers extend expiry; reset permits a new size', () => {
		const session = createCotpSession({ retentionMs: 20 });
		session.push(connect(0xe0, preferred([3])), receive());
		expect(event(session.push(connect(0xe0, preferred([3])), receive(19))).status).toBe('duplicate');
		expect(event(session.push(connect(0xd0, preferred([3])), receive(20, 'b-to-a'))).status).toBe('failed');
		expect(session.stats()).toMatchObject({ pending: 0, frozen: 1 });
		session.reset();
		expect(event(establish(session, preferred([5]), preferred([5]))).negotiation.tpduSize).toBe(640);
	});
	it('quarantines references after release of a preferred-size connection', () => {
		const session = createCotpSession({ freezeMs: 20 });
		establish(session, preferred([3]), preferred([3]));
		expect(event(session.push(release(), receive(1))).status).toBe('closed');
		expect(event(session.push(connect(0xe0, preferred([4])), receive(2))).status).toBe('failed');
		expect(event(establish(session, preferred([4]), preferred([4]), 21)).negotiation.tpduSize).toBe(512);
	});
	it('copies raw preferred bytes and public negotiation values before retaining session state', () => {
		const session = createCotpSession();
		const wire = connect(0xe0, preferred([3]));
		const requested = session.push(wire, receive());
		wire[9] = 1;
		requested.packet.pdus[0].parameters.find((p) => p.id === 0xf0).raw[0] = 1;
		const result = session.push(connect(0xd0, preferred([3])), receive(1, 'b-to-a'));
		expect(event(result).negotiation.tpduSize).toBe(384);
		event(result).negotiation.tpduSize = 128;
		expect(session.push(data(0, new Uint8Array(384 - 9)), receive(2)).assemblies[0].status).toBe('complete');
	});
});
