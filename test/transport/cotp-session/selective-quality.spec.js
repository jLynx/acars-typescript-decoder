import { describe, expect, it } from 'vitest';
import { createCotpSession } from '@/framing';
import { connect, establish, ack, data, tpdu, receive } from './wire';
const event = (result) => result.events.at(-1);
const selective = (edges, extended = false) => [
	0x8f,
	edges.flatMap((value) =>
		extended ? [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255] : [value],
	),
];

describe('COTP selective ACK, QoS/protection and negotiated checksum omission', () => {
	it('retains protection bytes and directional QoS with documented units and default average', () => {
		const e = createCotpSession();
		const result = event(
			establish(e, {
				parameters: [
					[0xc5, [1, 2]],
					[0x87, [0, 3]],
					[0x86, [8, 5, 7]],
					[0x88, [0, 10, 0, 20, 0, 30, 0, 40]],
					[0x89, [0, 0, 100, 0, 0, 50, 0, 0, 80, 0, 0, 40]],
					[0xc7, [0x30, 0x20]],
					[0x8b, [0, 5]],
				],
			}),
		);
		expect(result).toMatchObject({
			status: 'established',
			negotiation: {
				initiatorQuality: {
					protection: Uint8Array.of(1, 2),
					priority: 3,
					residualError: { targetExponent: 8, minimumExponent: 5, tsduSizeExponent: 7 },
					throughput: { maximum: [100, 50, 80, 40], average: [100, 50, 80, 40], unit: 'octets/s' },
					transitDelay: { values: [10, 20, 30, 40], unit: 'ms', tsduBytes: 128 },
					alternativeClasses: [3, 2],
					reassignmentSeconds: 5,
				},
			},
		});
		result.negotiation.initiatorQuality.protection[0] = 9;
		expect(e.push(data(), receive(1)).assemblies[0].status).toBe('complete');
	});
	it.each([
		[0x86, 2],
		[0x87, 1],
		[0x88, 7],
		[0x89, 13],
		[0x8b, 3],
	])('rejects malformed QoS ID=%i', (id, length) => {
		const e = createCotpSession();
		expect(event(e.push(connect(0xe0, { parameters: [[id, new Uint8Array(length)]] }), receive())).status).toBe(
			'failed',
		);
	});
	it.each([false, true])(
		'retains selective ranges through credit reductions and trims cumulative ACK, extended=%s',
		(extended) => {
			const e = createCotpSession();
			expect(
				event(establish(e, { additional: 17, extended }, { additional: 17, extended })).negotiation
					.selectiveAcknowledgement,
			).toBe(true);
			let result = event(
				e.push(ack(0, { extended, parameters: [selective([3, 5, 7, 8], extended)] }), receive(1, 'b-to-a')),
			);
			expect(result.acknowledgement.selectiveBlocks).toEqual([
				{ lower: 3, upper: 5 },
				{ lower: 7, upper: 8 },
			]);
			result = event(e.push(ack(0, { extended, credit: 0, parameters: [[0x8a, [0, 1]]] }), receive(2, 'b-to-a')));
			expect(result.acknowledgement.selectiveBlocks).toHaveLength(2);
			expect(e.push(data(4, [9], { extended }), receive(3)).assemblies[0]).toMatchObject({
				status: 'pending',
				transmission: { withinAdvertisedWindow: false, selectivelyAcknowledged: true },
			});
			expect(event(e.push(ack(5, { extended }), receive(4, 'b-to-a'))).acknowledgement.selectiveBlocks).toEqual([
				{ lower: 5, upper: 5 },
				{ lower: 7, upper: 8 },
			]);
			expect(event(e.push(ack(9, { extended }), receive(5, 'b-to-a'))).acknowledgement.selectiveBlocks).toEqual([]);
			expect(e.stats().bytes).toBeGreaterThan(0); // ACK did not manufacture missing payload.
		},
	);
	it.each([[], [1], [0, 2], [3, 2], [3, 5, 5, 8], [3, 5, 6, 7], [130, 133]].map((edges) => [edges]))(
		'rejects malformed selective ranges %j',
		(edges) => {
			const e = createCotpSession();
			establish(e, { additional: 17 }, { additional: 17 });
			expect(event(e.push(ack(0, { parameters: [selective(edges)] }), receive(1, 'b-to-a'))).status).toBe('failed');
		},
	);
	it('rejects unsolicited selection/blocks and applies last-occurrence options', () => {
		expect(event(establish(createCotpSession(), { additional: 1 }, { additional: 17 })).status).toBe('failed');
		const e = createCotpSession();
		establish(e);
		expect(event(e.push(ack(0, { parameters: [selective([1, 2])] }), receive(1, 'b-to-a'))).status).toBe('failed');
	});
	it('accepts omission only after protected CR and mutual selection, retaining unverified integrity', () => {
		const e = createCotpSession();
		expect(event(establish(e, { additional: 3 }, { additional: 3, checksum: false }))).toMatchObject({
			status: 'established',
			negotiation: { checksum: 'omitted' },
		});
		const result = e.push(tpdu([0xf0, 0, 22, 128], [], [9], false), receive(1));
		expect(result.packet.integrity).toBe('unverified');
		expect(result.assemblies[0]).toMatchObject({
			status: 'complete',
			payload: Uint8Array.of(9),
			integrity: 'unverified',
		});
		const corrupt = data(1);
		corrupt[corrupt.length - 1] ^= 1;
		expect(event(e.push(corrupt, receive(2))).status).toBe('failed');
	});
	it('rejects omitted CR, unoffered omission, malformed CC and required-checksum data', () => {
		expect(event(createCotpSession().push(connect(0xe0, { additional: 3, checksum: false }), receive())).status).toBe(
			'failed',
		);
		expect(event(establish(createCotpSession(), { additional: 1 }, { additional: 3, checksum: false })).status).toBe(
			'failed',
		);
		expect(
			event(establish(createCotpSession(), { additional: 3 }, { additional: 3, checksum: false, version: 2 })).status,
		).toBe('failed');
		const e = createCotpSession();
		establish(e);
		expect(event(e.push(tpdu([0xf0, 0, 22, 128], [], [9], false), receive(1))).status).toBe('failed');
	});
});
