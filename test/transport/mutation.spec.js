import { describe, expect, it } from 'vitest';
import {
	decodeAvlc,
	decodeXid,
	decodeX25,
	decodeClnpCompressed,
	decodeClnp,
	decodeEsis,
	decodeCotp,
	decodeIdrp,
} from '@/index';

const fixture = Uint8Array.from(
	Buffer.from(
		'94049CA2101040AFBF828000140109383838353A3139393302020001030320A480F000180001560101010301050401258304474D4D5784041A70042549C5',
		'hex',
	),
);
const readers = [decodeXid, decodeX25, decodeClnpCompressed, decodeClnp, decodeEsis, decodeCotp, decodeIdrp];

describe('deterministic transport mutation regressions', () => {
	it('withholds every inner payload after a single bit error in a verified AVLC frame', () => {
		for (let bit = 0; bit < fixture.length * 8; bit++) {
			const damaged = fixture.slice();
			damaged[bit >> 3] ^= 1 << (bit % 8);
			// Address extension errors are structural rejection; all other one-bit errors must fail FCS.
			try {
				const result = decodeAvlc(damaged);
				expect(result.integrity).toBe('failed');
				expect(result.payload).toBeUndefined();
			} catch (error) {
				expect(error.message).toMatch(/address extension/);
			}
			expect(damaged.length).toBe(fixture.length);
		}
	});
	it('never mutates bounded arbitrary data or leaks non-finite header values', () => {
		let state = 0xdec0de;
		const next = () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state >>> 24;
		};
		const finite = (value) => {
			if (value instanceof Uint8Array || value === undefined || value === null) return;
			if (typeof value === 'number') {
				expect(Number.isFinite(value)).toBe(true);
				return;
			}
			if (typeof value === 'object') for (const item of Object.values(value)) finite(item);
		};
		for (let length = 0; length < 256; length++) {
			const bytes = Uint8Array.from({ length }, next),
				before = bytes.slice();
			for (const read of readers) {
				const result = read(bytes);
				finite(result);
				expect(bytes).toEqual(before);
			}
		}
	});
});
