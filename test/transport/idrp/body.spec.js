import { describe, expect, it } from 'vitest';
import { decodeIdrp } from '@/framing';
const frame = (type, body = []) =>
	Uint8Array.from([0x85, 0, 30 + body.length, type, 0, 0, 0, 1, 0, 0, 0, 2, 3, 4, ...new Array(16).fill(0), ...body]);
describe('IDRP body layout and raw authentication evidence', () => {
	it('reads Open timers, PDU limit, RD identifiers, RIB sets and authentication without asserting integrity', () => {
		const result = decodeIdrp(
			frame(1, [1, 0, 30, 16, 0, 2, 0x47, 1, 1, 2, 4, 11, 0, 2, 8, 9, 1, 2, 0x47, 2, 3, 0xaa, 0xbb]),
		);
		expect(result).toMatchObject({
			integrity: 'unverified',
			coverage: 'partial',
			open: {
				version: 1,
				holdingTime: 30,
				holdingTimeUnit: 's',
				maxPduSize: 4096,
				sourceRdi: Uint8Array.of(0x47, 1),
				ribAttributeSets: [[{ id: 4 }, { id: 11, raw: Uint8Array.of(8, 9) }]],
				confederations: [Uint8Array.of(0x47, 2)],
				authentication: 3,
				authenticationData: Uint8Array.of(0xaa, 0xbb),
			},
		});
		expect(result.validation).toHaveLength(16);
	});
	it('reads withdrawn route IDs, bounded attributes, and CLNP prefix bits', () => {
		const result = decodeIdrp(
			frame(
				2,
				[
					0, 1, 0, 0, 0, 42, 0, 15, 0x40, 1, 0, 5, 0, 0, 0, 43, 7, 0x80, 16, 0, 2, 9, 10, 1, 1, 0x81, 0, 3, 9, 0x47,
					0x80,
				],
			),
		);
		expect(result.update).toMatchObject({
			withdrawnRoutes: [42],
			attributes: [
				{ id: 1, value: { routeId: 43, localPreference: 7 } },
				{ id: 16, raw: Uint8Array.of(9, 10) },
			],
			reachability: [
				{ protocolType: 1, protocol: Uint8Array.of(0x81), prefixBits: 9, address: Uint8Array.of(0x47, 0x80) },
			],
		});
	});
	it('reads Error FSM details and recognizes empty Keepalive/Cease', () => {
		expect(decodeIdrp(frame(3, [4, 0x25, 9])).error).toEqual({
			code: 4,
			subcode: 0x25,
			data: Uint8Array.of(9),
			relatedType: 2,
			state: 5,
		});
		for (const type of [4, 5]) expect(decodeIdrp(frame(type)).coverage).toBe('decoded');
		expect(decodeIdrp(frame(6, [1, 2])).coverage).toBe('partial');
	});
	it('retains every truncated body and bounds counts/lengths/duplicate attributes', () => {
		const good = [1, 0, 30, 16, 0, 2, 0x47, 1, 0, 0, 1];
		for (let i = 0; i < good.length; i++) {
			const body = good.slice(0, i),
				result = decodeIdrp(frame(1, body));
			expect(result.open).toBeUndefined();
			expect(result.reason).toBeTruthy();
			expect([...result.payload]).toEqual(body);
		}
		for (const body of [
			[0, 255, 1, 2],
			[0, 0, 0, 10, 0, 4, 0, 20],
			[0, 0, 0, 0, 1, 1, 0x81, 0, 2, 16, 0x47],
		])
			expect(decodeIdrp(frame(2, body)).reason).toBeTruthy();
		expect(decodeIdrp(frame(4, [1])).reason).toMatch(/Unexpected/);
	});
});
