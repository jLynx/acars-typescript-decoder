import { describe, expect, it } from 'vitest';
import { decodeXid } from '@/framing';
const xid = (parts) => {
	const body = parts.flatMap(([id, raw]) => [id, raw.length, ...raw]);
	return Uint8Array.from([0x82, 0xf0, body.length >>> 8, body.length & 255, ...body]);
};
describe('additional pinned VDL2 XID parameters', () => {
	it('reads management flag bits, sequencing, refusal data and modulation masks without guessing delay units', () => {
		const result = decodeXid(
			xid([
				[1, [0x56]],
				[3, [0x53]],
				[6, [0x81, 1, 2, 9]],
				[0x81, [0x86]],
			]),
		);
		expect(result.type).toBe('HO');
		expect(result.groups[0].parameters).toMatchObject([
			{ value: 0x56 },
			{ sequencing: { sequence: 3, retry: 5 } },
			{ refusal: { cause: 0x81, delayRaw: 258, additional: Uint8Array.of(9) } },
			{ modulations: { vdl2: true, vdl3: true, unknownMask: 128 } },
		]);
	});
	it('decodes autotune channel and address lists and keeps malformed lengths partial', () => {
		const result = decodeXid(
			xid([
				[0x40, [0x2e, 0x71]],
				[0x82, [0, 0, 0, 9]],
				[0xc3, [78, 90, 65, 65]],
			]),
		);
		expect(result.groups[0].parameters[0].autotune).toEqual({ frequency: 136.975, unit: 'MHz', modulationMask: 2 });
		expect(result.groups[0].parameters[1].value).toHaveLength(1);
		expect(result.groups[0].parameters[2].value).toBe('NZAA');
		for (const [id, raw] of [
			[3, []],
			[6, [1, 2]],
			[0x81, [1, 2]],
			[0x40, [1]],
			[0x82, [0, 0, 0]],
		]) {
			const malformed = decodeXid(xid([[id, raw]]));
			expect(malformed.coverage).toBe('partial');
			expect([...malformed.groups[0].parameters[0].raw]).toEqual(raw);
		}
	});
	it('names remaining timers/counters but leaves encoding and units unverified', () => {
		const result = decodeXid(
			xid([
				[0x45, [1, 2]],
				[0xc4, [0x47, 1]],
				[0xfe, [2]],
			]),
		);
		expect(result.groups[0].parameters[0].name).toBe('TM2 timer (raw)');
		expect(result.groups[0].parameters[0].value).toBeUndefined();
		expect(result.coverage).toBe('partial');
	});
	it('retains unknown modulation masks as partial instead of claiming complete interpretation', () => {
		for (const parts of [[[0x81, [0x86]]], [[0x40, [0x8e, 0x71]]]]) {
			expect(decodeXid(xid(parts)).coverage).toBe('partial');
		}
	});
});
