import { describe, expect, it } from 'vitest';
import { createDecoder } from '@/api';
import { airportName } from '@/reference/airports/airports';

const { decode, decodeLog } = createDecoder({ airportLookup: airportName });
const field = (result, label) => result.fields.find((f) => f.label === label)?.value;
// Sanitized observed header layouts; numeric bodies are synthetic. No private captures are distributed.
const variants = [
	{ code: 'AER9', text: '#DFB<305>AER9   4\r\n B-1234CCA0999    101026075107NZAAZBAA\r\n1,2,3' },
	{ code: 'HEG9', text: '#DFB/ILNGE7X.<102>HEG9   2\r\n B-1234CCA0999   NZAAZBAA 279TA101026075107  743\r\n1,2,3' },
	{ code: 'KER9', text: '#DFB/ABZDS8X.<102>KER9 \r\n B-1234CCA0999    TO 253101026075107NZAAZBAA545103  4\r\n1,2,3' },
];
const tof = '#T5B/ILNGE7X.TOF005HU B-12341CHH0999   261010075653NZAAZGSZ-001+002';
const apu = '#DFBAPU1\r\nNZAA/ZGSZ/\r\n0000000 /\r\n    00100/ 00200';
const part = '#DFBA380000051,2,2,TB000000;174+03639;-18000000';
const record = (id, text, extra = {}) => ({
	id,
	text,
	label: 'H1',
	registration: 'B-1234',
	mode: '2',
	acknowledgement: 'NAK',
	blockId: String(id),
	direction: 'downlink',
	flight: 'CA0999',
	receivedAt: 1_791_610_000_000 + id * 1000,
	messageNumber: `D01${String.fromCharCode(64 + id)}`,
	continuation: true,
	...extra,
});

describe('captured aircraft report variants', () => {
	it.each(variants)('extracts $code header identifiers without measurement/date guesses', ({ code, text }) => {
		const input = record(1, text);
		const result = decode(input);
		expect(result).toMatchObject({ title: `Aircraft report ${code}`, coverage: 'partial' });
		expect(field(result, 'Reported registration')).toBe('B-1234');
		expect(field(result, 'Reported flight code')).toBe('CCA0999');
		expect(field(result, 'Departure')).toBe('NZAA · Auckland International Airport');
		expect(field(result, 'Destination')).toBe('ZBAA · Beijing Capital International Airport');
		expect(field(result, 'Header date code (raw)')).toBe('101026');
		expect(field(result, 'Header time code (raw)')).toBe('075107');
		expect(result.fields.some((f) => /UTC|local|fuel|temperature|altitude/.test(f.label))).toBe(false);
		expect(input.text).toBe(text);
		expect(result.fields.filter((f) => f.label === 'Departure')).toHaveLength(1);
	});
	it.each(variants)('withholds optional $code identifiers when the header is truncated', ({ text }) => {
		const truncated = text.slice(0, text.lastIndexOf('\r\n') - 1);
		expect(field(decode(record(1, truncated)), 'Reported registration')).toBeUndefined();
	});
	it.each(variants)('accepts a complete $code identifier header at the end of an ETX body', ({ text }) => {
		const result = decode(record(1, text.slice(0, text.lastIndexOf('\r\n')), { continuation: false }));
		expect(field(result, 'Reported registration')).toBe('B-1234');
	});
	it.each(variants)('withholds unterminated $code numeric header fields at an ETB boundary', ({ text }) => {
		expect(field(decode(record(1, text.slice(0, text.lastIndexOf('\r\n')))), 'Reported registration')).toBeUndefined();
	});
	it.each(variants)('does not apply $code header parsing to another application or uplink', ({ text }) => {
		expect(field(decode(record(1, text.replace('#DFB', '#T6B'))), 'Reported registration')).toBeUndefined();
		expect(field(decode(record(1, text, { direction: 'uplink' })), 'Reported registration')).toBeUndefined();
	});
	it.each(variants)(
		'retains $code on complete assembly and associates only same-source continuation context',
		({ text, code }) => {
			const blocks = [record(1, text), record(2, '#DFB4,5'), record(3, '#DFB6', { continuation: false })];
			const result = decodeLog(blocks);
			expect(result[2].interpretation.title).toBe(`Aircraft report ${code}`);
			expect(field(result[2].interpretation, 'Reported registration')).toBe('B-1234');
			expect(field(result[1].interpretation, 'Reported registration (from first block)')).toBe('B-1234');
			expect(result[2].assembledText).toBe(text + '4,56');
			expect(result.map((m) => m.text)).toEqual(blocks.map((m) => m.text));
			expect(
				field(decodeLog([blocks[1]])[0].interpretation, 'Reported registration (from first block)'),
			).toBeUndefined();
		},
	);
	it('recognizes an APU1 route without guessing its numeric column meanings', () => {
		const result = decode(record(1, apu, { continuation: false }));
		expect(result).toMatchObject({ title: 'Aircraft report APU1', coverage: 'partial' });
		expect(field(result, 'Report code')).toBe('APU1');
		expect(field(result, 'Destination')).toBe("ZGSZ · Shenzhen Bao'an International Airport");
		expect(result.fields).toHaveLength(4);
	});
	it.each([apu.replace('NZAA/ZGSZ/', 'NZAA/'), apu.replace('APU1', 'APU2'), apu.replace('#DFB', '#T6B')])(
		'does not decode an incompatible APU layout',
		(text) => {
			expect(decode(record(1, text)).coverage).toBe('unknown');
		},
	);
	it('extracts the T5/TOF identifiers with the separator and compact clock kept raw', () => {
		const result = decode(record(1, tof));
		expect(result).toMatchObject({ title: 'Aircraft report TOF', coverage: 'partial' });
		expect(field(result, 'Reported registration')).toBe('B-1234');
		expect(field(result, 'Reported flight code')).toBe('CHH0999');
		expect(field(result, 'Header separator (raw)')).toBe('1');
		expect(field(result, 'Header date code (raw)')).toBe('261010');
		expect(field(result, 'Header time code (raw)')).toBe('075653');
		expect(field(result, 'Routing address')).toBe('ILNGE7X');
		expect(field(result, 'Departure')).toContain('NZAA');
		expect(result.fields.some((f) => /UTC|local|altitude|fuel/.test(f.label))).toBe(false);
	});
	it('recognizes the complete T5 assembly and contextualizes its intermediate blocks', () => {
		const blocks = [record(1, tof), record(2, '#T5BABC'), record(3, '#T5BDEF', { continuation: false })];
		const result = decodeLog(blocks);
		expect(result[2].assembledText).toBe(tof + 'ABCDEF');
		expect(result[2].interpretation.title).toBe('Aircraft report TOF');
		expect(field(result[1].interpretation, 'Reported registration (from first block)')).toBe('B-1234');
		expect(result[1].interpretation.coverage).toBe('unknown');
		expect(result[2].interpretation.coverage).toBe('partial');
	});
	it.each([tof.replace('#T5B', '#T6B'), tof.replace('#T5B', '#DFB'), tof.slice(0, 52)])(
		'withholds TOF identifiers for incompatible/truncated layouts',
		(text) => {
			expect(field(decode(record(1, text)), 'Reported registration')).toBeUndefined();
		},
	);
	it('does not share T5 context with DF, another flight, or another aircraft', () => {
		for (const changes of [{ text: '#DFBABC' }, { flight: 'XX0001' }, { registration: 'B-9999' }]) {
			const result = decodeLog([record(1, tof), record(2, '#T5BABC', changes)]);
			expect(field(result[1].interpretation, 'Reported registration (from first block)')).toBeUndefined();
		}
	});
	it('recognizes a configuration-only Airbus part without inheriting a report ID', () => {
		const result = decode(record(1, part));
		expect(result).toMatchObject({ title: 'A380 aircraft report part', coverage: 'partial' });
		expect(field(result, 'Aircraft type')).toBe('A380');
		expect(field(result, 'Configuration header (raw)')).toBe('000051,2,2,TB000000');
		expect(field(result, 'Report ID')).toBeUndefined();
		expect(field(result, 'Departure')).toBeUndefined();
	});
	it.each([part.slice(0, 26), part.replace('TB000000', 'XX000000'), part.replace('#DFB', '#T6B')])(
		'does not claim malformed configuration-only parts',
		(text) => {
			expect(decode(record(1, text)).coverage).toBe('unknown');
		},
	);
});
