import { describe, expect, it } from 'vitest';
import { Bits } from '@/payload/protocols/bits';
import { routeClearance, errorInformation } from '@/payload/protocols/cpdlc/route';
import { decodeCpdlc } from '@/index';
import { interpretArinc } from '@/payload/arinc';

const integer = (width, value) => value.toString(2).padStart(width, '0');
const text = (value) => [...value].map((c) => integer(7, c.charCodeAt(0))).join('');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (v) => parseInt(v, 2));

describe('FANS routes and error information', () => {
	it('decodes optional airports, runway and ordered published fixes/airways', () => {
		const binary =
			'1110000010' +
			text('NZAA') +
			text('NZCH') +
			integer(6, 22) +
			integer(2, 0) +
			integer(7, 1) +
			'0000' +
			integer(3, 4) +
			text('EMRAG') +
			'100' +
			integer(3, 3) +
			text('Y123');
		expect(routeClearance(new Bits(bytes(binary)))).toBe(
			'departure NZAA · destination NZCH · departure runway 23L · EMRAG · airway Y123',
		);
	});
	it('decodes an instruction and consumes its complete route body', () => {
		const route = '1100000000' + text('NZAA') + text('NZCH');
		expect(decodeCpdlc(bytes('000' + integer(6, 4) + integer(8, 80) + route), 'uplink')).toMatchObject({
			complete: true,
			summary: 'CLEARED departure NZAA · destination NZCH',
		});
	});
	it('keeps unsupported route choices and additional route structures partial', () => {
		for (const route of ['0000000001', '0000000010' + integer(7, 0) + '010']) {
			expect(decodeCpdlc(bytes('000' + integer(6, 4) + integer(8, 80) + route), 'uplink').complete).toBe(false);
		}
	});
	it('rejects reserved runway values', () =>
		expect(() => routeClearance(new Bits(bytes('0010000000' + integer(6, 36) + '00')))).toThrow());
	it.each(Array.from({ length: 17 }, (_, i) => i))('decodes error code %s within its defined range', (code) => {
		expect(errorInformation(new Bits(bytes(integer(5, code))))).toBeTypeOf('string');
		expect(decodeCpdlc(bytes('000' + integer(6, 4) + integer(8, 62) + integer(5, code)), 'downlink').complete).toBe(
			true,
		);
	});
	it('rejects unused error codes', () => expect(() => errorInformation(new Bits(bytes(integer(5, 17))))).toThrow());
	it('rejects the pinned Rust datalink fixture with a failed application CRC', () => {
		const result = interpretArinc(
			'YEGE2YA.AT1.N618UP2B5DEA8A3BB974E246A106743413B324CCA6C5ACB42A45A54D9CA9262CB9814DA800B2001372962DC004DE000BC00137A003040042549F5A0C409524C59730A0499368458AA41912A498B2E61C732250A91695321901129CB8B3A9E0',
			'downlink',
		);
		expect(result.coverage).toBe('partial');
		expect(result.fields.find((f) => f.label === 'Application CRC').value).toContain('Failed');
		expect(result.fields.some((f) => f.label.startsWith('CPDLC instruction'))).toBe(false);
	});
});
