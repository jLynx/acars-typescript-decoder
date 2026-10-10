import { describe, expect, it } from 'vitest';
import { createAeroReassembler, decodeAeroSignalUnit } from '@/framing';
import { payload, wireBytes } from '../../framing/fixtures';
// Independent bit-wise division; signal-unit CRC bytes are little endian.
const frame = (body) => {
	let c = 65535;
	for (const b of body)
		for (let bit = 0; bit < 8; bit++) {
			const low = (c ^ (b >>> bit)) & 1;
			c = (c >>> 1) ^ (low ? 0x8408 : 0);
		}
	c ^= 65535;
	return Uint8Array.from([...body, c & 255, c >>> 8]);
};
const r = (body, indicator = 1, { aes = 0xabcdef, ges = 5, queue = 2, reference = 3 } = {}) =>
	frame([
		indicator * 16 + body.length,
		queue * 16 + reference + 8,
		aes >>> 16,
		(aes >>> 8) & 255,
		aes & 255,
		ges,
		...body,
		...new Array(11 - body.length).fill(0),
	]);
const pt = (body, total, lastLength = 8, options = {}) =>
	frame([113, 0xab, 0xcd, 0xef, 5, options.reference ?? 35, total, lastLength * 16, ...body]);
const ssu = (body, sequence = 0, reference = 35) =>
	frame([192 + sequence, reference, ...body, ...new Array(8 - body.length).fill(0)]);
const reception = (receivedAt = 0, link = 'test', direction = 'downlink') => ({ receivedAt, link, direction });
const push = (e, bytes, channel = 'R', at = 0, link = 'test') => e.push(bytes, channel, reception(at, link));

describe('demodulated Aero R/P/T signal units', () => {
	it('decodes one R SU and reassembles two/three reversed segments by AES/GES/QNO/REF', () => {
		const e = createAeroReassembler();
		expect(push(e, r([1, 2, 3]))).toMatchObject({
			status: 'complete',
			payload: Uint8Array.of(1, 2, 3),
			aircraft: 0xabcdef,
			groundStation: 5,
		});
		e.reset();
		const first = Array.from({ length: 11 }, (_, i) => i);
		expect(push(e, r([11, 12], 3)).status).toBe('pending');
		expect(push(e, r(first, 2)).payload).toEqual(Uint8Array.from([...first, 11, 12]));
		e.reset();
		push(e, r([22], 6));
		push(e, r(first, 5));
		expect(push(e, r(first, 4)).payload).toHaveLength(23);
	});
	it.each(['P', 'T'])('assembles %s countdown SSUs including arbitrary arrival order and duplicates', (channel) => {
		const e = createAeroReassembler();
		expect(push(e, ssu([1, 2], 0), channel).status).toBe('ignored');
		push(e, pt([1, 2], 2, 3), channel);
		expect(push(e, ssu([11, 12, 13], 0), channel).status).toBe('pending');
		const middle = ssu([3, 4, 5, 6, 7, 8, 9, 10], 1);
		expect(push(e, middle, channel).payload).toEqual(Uint8Array.from({ length: 13 }, (_, i) => i + 1));
		expect(push(e, middle, channel).status).toBe('duplicate');
	});
	it('uses verified ACARS parity/BCS after SU assembly and respects direction', () => {
		const bytes = Uint8Array.from([255, 255, 1, ...wireBytes(payload('/TEST', 'A')).slice(3)]);
		const assemble = (data, direction = 'downlink') => {
			const e = createAeroReassembler(),
				rest = data.slice(2),
				count = Math.ceil(rest.length / 8),
				last = rest.length - (count - 1) * 8;
			e.push(pt(data.slice(0, 2), count, last), 'P', reception(0, 'test', direction));
			let result;
			for (let i = 0; i < count; i++)
				result = e.push(ssu(rest.slice(i * 8, i * 8 + 8), count - i - 1), 'P', reception(0, 'test', direction));
			return result;
		};
		expect(assemble(bytes).acars).toMatchObject({ label: 'H1', text: '/TEST', direction: 'downlink', blockId: 'A' });
		const corrupt = bytes.slice();
		corrupt[18] ^= 1;
		expect(assemble(corrupt).acars).toBeUndefined();
		expect(assemble(bytes, 'uplink').acars).toMatchObject({ direction: 'uplink', text: '/TEST' });
	});
	it('isolates links/references and rejects conflicting segments and CRC failures', () => {
		const e = createAeroReassembler(),
			part = new Array(11).fill(1);
		push(e, r(part, 2));
		expect(push(e, r([2], 3), 'R', 0, 'other').status).toBe('pending');
		expect(push(e, r([2], 3, { reference: 4 })).status).toBe('pending');
		const bad = r([2], 3);
		bad[6] ^= 1;
		expect(push(e, bad).status).toBe('failed');
		expect(push(e, r(new Array(11).fill(2), 2)).reason).toMatch(/Conflicting/);
		expect(push(e, r([2], 3)).status).toBe('failed');
	});
	it('bounds records/bytes, expires old state, resets and retains unsupported controls', () => {
		const e = createAeroReassembler({ maxMessages: 1, maxBytes: 12, retentionMs: 10 }),
			part = new Array(11).fill(1);
		push(e, r(part, 2));
		expect(push(e, r([2], 3, { reference: 4 }), 'R', 1).discarded).toHaveLength(1);
		expect(push(e, r(part, 2, { reference: 4 }), 'R', 2).status).toBe('complete');
		expect(push(e, r([3]), 'R', 12).discarded).toHaveLength(1);
		expect(push(e, r([3]), 'R', 11).status).toBe('failed');
		e.reset();
		expect(e.stats().bytes).toBe(0);
		const control = frame(new Array(10).fill(0));
		expect(push(e, control, 'P').status).toBe('ignored');
		expect(() => decodeAeroSignalUnit(r([1]).slice(0, -1), 'R')).toThrow();
		expect(() => decodeAeroSignalUnit(pt([1, 2], 0), 'P')).toThrow();
		expect(() => decodeAeroSignalUnit(r([1], 2), 'R')).toThrow();
	});
});
