import { describe, expect, it } from 'vitest';
import { networkOptions } from '@/transport/network/iso';
const option = (id, raw) => networkOptions(Uint8Array.from([id, raw.length, ...raw]))[0];
describe('X.233 1997 network option fields', () => {
	it('reads QoS flags, security classification context, priority and discard location', () => {
		expect(option(0xc3, [0xff]).decoded).toMatchObject({
			format: 3,
			qosUnavailable: true,
			sequencingPreferred: true,
			congestionExperienced: true,
			lowDelayOverCost: true,
			lowErrorOverDelay: true,
			lowErrorOverCost: true,
		});
		expect(option(0xc5, [0x80, 1, 2]).decoded).toMatchObject({ format: 2, data: Uint8Array.of(1, 2) });
		expect(option(0xcd, [14]).value).toBe(14);
		expect(option(0xc1, [0x22, 4]).decoded).toEqual({ discardReason: 0x22, errorOffset: 4 });
	});
	it('reads source-route entry boundaries and retains unused record-route capacity', () => {
		expect(option(0xc8, [1, 6, 2, 1, 2, 1, 3]).decoded).toMatchObject({
			mode: 'complete',
			pointer: 6,
			entries: [{ address: Uint8Array.of(1, 2) }, { address: Uint8Array.of(3) }],
		});
		expect(option(0xcb, [0, 6, 2, 1, 2, 0, 0]).decoded).toMatchObject({
			mode: 'partial',
			entries: [{ address: Uint8Array.of(1, 2) }],
			unused: Uint8Array.of(0, 0),
		});
	});
	it('distinguishes UTC milliseconds from unspecified timestamp values', () => {
		expect(option(0xcb, [2, 8, 4, 0, 0, 3, 232]).decoded.entries[0]).toMatchObject({
			timestamp: 1000,
			timestampUnit: 'ms',
			utcMidnight: true,
			address: new Uint8Array(),
		});
		expect(option(0xcb, [3, 9, 5, 128, 0, 0, 5, 1]).decoded.entries[0]).toMatchObject({
			timestamp: 5,
			utcMidnight: false,
			address: Uint8Array.of(1),
		});
	});
	it('reads scope prefixes/radius and accepts zero-length padding', () => {
		expect(option(0xc4, [9, 0xab, 0x80]).decoded.prefixes).toEqual([{ bits: 9, bytes: Uint8Array.of(0xab, 0x80) }]);
		expect(option(0xc6, [1, 2]).decoded.radius).toBe(258);
		expect(option(0xcc, []).raw).toHaveLength(0);
	});
	it.each([
		[0xc8, [1, 4, 2, 1, 2]],
		[0xcb, [2, 6, 2, 1, 2]],
		[0xc4, [9, 1, 1]],
		[0xc4, [16, 1]],
		[0xc3, [0, 1]],
		[0xcd, [15]],
		[0xc1, [1]],
	])('retains malformed/reserved ID=%i bytes with a reason', (id, raw) => {
		const result = option(id, raw);
		expect(result.decoded).toBeUndefined();
		expect(result.reason).toBeTruthy();
		expect([...result.raw]).toEqual(raw);
	});
});
