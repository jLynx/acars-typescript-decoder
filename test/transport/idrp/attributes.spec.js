import { describe, expect, it } from 'vitest';
import { decodeIdrp, decodeAtnSecurityLabel } from '@/framing';
const attr = (id, raw) => [0x80, id, raw.length >>> 8, raw.length & 255, ...raw];
const update = (attributes) => {
	const body = [0, 0, attributes.length >>> 8, attributes.length & 255, ...attributes];
	return Uint8Array.from([0x85, 0, 30 + body.length, 2, ...new Array(26).fill(0), ...body]);
};
describe('IDRP RD paths and ATN security labels', () => {
	it('decodes all four RD segment forms without including following identifiers in their bytes', () => {
		const raw = [1, 0, 5, 1, 0x47, 2, 1, 2, 2, 0, 2, 1, 3, 3, 0, 2, 1, 4, 4, 0, 2, 1, 5];
		const result = decodeIdrp(update(attr(3, raw))).update.attributes[0];
		expect(result.rdPath.map((p) => p.name)).toEqual(['RD_SET', 'RD_SEQ', 'ENTRY_SEQ', 'ENTRY_SET']);
		expect(result.rdPath[0].identifiers).toEqual([Uint8Array.of(0x47), Uint8Array.of(1, 2)]);
		expect(result.rdPath[1].identifiers).toEqual([Uint8Array.of(3)]);
		expect(result.raw).toEqual(Uint8Array.from(raw));
	});
	it('preserves unknown segments and marks truncated/zero identifiers without dropping whole updates', () => {
		expect(decodeIdrp(update(attr(3, [9, 0, 1, 7]))).update.attributes[0].rdPath[0]).toMatchObject({
			name: 'Unknown',
			raw: Uint8Array.of(7),
		});
		for (const raw of [[1], [1, 0, 2, 1], [1, 0, 1, 0], [1, 0, 2, 2, 1]]) {
			const result = decodeIdrp(update(attr(3, raw))).update.attributes[0];
			expect(result.reason).toBeTruthy();
			expect(result.rdPath).toBeUndefined();
			expect([...result.raw]).toEqual(raw);
		}
	});
	it('reads security registration and every known tag, retaining unknown names and route policy', () => {
		const tags = [1, 3, 1, 2, 1, 5, 2, 5, 3, 1, 6, 1, 0x81, 1, 7, 1, 0x10, 1, 15, 1, 0x30, 2, 1, 2, 1, 9];
		const bytes = Uint8Array.from([2, 0x47, 1, tags.length, ...tags]);
		const result = decodeAtnSecurityLabel(bytes);
		expect(result).toMatchObject({ registration: Uint8Array.of(0x47, 1), coverage: 'partial' });
		expect(result.tags[1].subnetwork).toEqual({ id: 5, permittedTraffic: 3 });
		expect(result.tags[2]).toMatchObject({ value: 0x81, allowNonAtsc: false });
		expect(result.tags[3].allowNonAtsc).toBe(true);
		expect(result.tags[4].traffic).toMatchObject({ type: 'administrative', routePolicy: 16 });
		expect(decodeIdrp(update(attr(14, [...bytes]))).update.attributes[0].security).toEqual(result);
	});
	it.each([
		[0x01, 'operational', 'ATSC'],
		[0x21, 'operational', 'AOC'],
		[0x61, 'system-management', undefined],
	])('decodes traffic %i', (value, type, category) => {
		expect(decodeAtnSecurityLabel(Uint8Array.of(0, 4, 1, 15, 1, value)).tags[0].traffic).toEqual({
			type,
			category,
			routePolicy: 1,
		});
	});
	it('honors declared security-info length, retains trailing data and rejects every malformed boundary', () => {
		expect(decodeAtnSecurityLabel(Uint8Array.of(0, 0, 9)).unconsumed).toEqual(Uint8Array.of(9));
		for (const raw of [
			[2, 1],
			[0, 4, 1],
			[0, 3, 2, 1, 2],
			[0, 4, 1, 3, 2, 1],
			[0, 3, 1, 5, 0],
		])
			expect(() => decodeAtnSecurityLabel(Uint8Array.from(raw))).toThrow();
		expect(decodeIdrp(update(attr(16, [1, 2]))).update.attributes[0].reason).toMatch(/one octet/);
	});
	it('validates empty Update scalar/security values without treating Open declarations as values', () => {
		for (const id of [1, 7, 13, 14, 15, 16]) {
			const result = decodeIdrp(update(attr(id, []))).update.attributes[0];
			expect(result.raw).toEqual(new Uint8Array());
			expect(result.reason).toBeTruthy();
		}
		const body = [1, 0, 30, 16, 0, 1, 0x47, 1, 2, 7, 13, 0, 0];
		const open = decodeIdrp(Uint8Array.from([0x85, 0, 30 + body.length, 1, ...new Array(26).fill(0), ...body]));
		expect(open.open.ribAttributeSets[0]).toMatchObject([{ id: 7 }, { id: 13 }]);
		expect(open.open.ribAttributeSets[0].every((part) => part.reason === undefined)).toBe(true);
	});
	it('retains unknown traffic subtypes as partial security evidence', () => {
		const label = decodeAtnSecurityLabel(Uint8Array.of(0, 4, 1, 15, 1, 0xe1));
		expect(label.coverage).toBe('partial');
		expect(label.tags[0]).toMatchObject({ raw: Uint8Array.of(0xe1), traffic: { type: undefined, routePolicy: 1 } });
	});
});
