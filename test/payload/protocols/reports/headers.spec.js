import { createDecoder } from '@/api';
import { airportName } from '@/reference/airports/airports';
import { describe, expect, it } from 'vitest';

const { decode, decodeLog } = createDecoder({ airportLookup: airportName });
const field = (result, label) => result.fields.find((item) => item.label === label)?.value;
// Sanitized header-only examples from the user's 10 October capture. Numeric bodies are deliberately synthetic.
const apm = '#DFBAPM    5 B-1234         CCA999  ZBAANZAA091026232805,\r\n,ACMFC001,1,2,3';
const ker = '#DFB<701>KER\r\n B-1234CCA999    ER 252091026232805ZBAANZAA4411669 C  8\r\n1,2,3';
const record = (id, text, extra = {}) => ({
	id,
	receivedAt: Date.parse('2026-10-10T04:24:00Z') + id * 1000,
	registration: 'B-1234',
	mode: '2',
	acknowledgement: 'NAK',
	label: 'H1',
	blockId: String(id),
	direction: 'downlink',
	messageNumber: `D01${String.fromCharCode(64 + id)}`,
	flight: 'CA0999',
	text,
	continuation: true,
	...extra,
});

describe('observed POS and DF report headers', () => {
	it('recognizes POS fields without interpreting ambiguous compact coordinates or numeric columns', () => {
		const result = decode(record(1, 'POS100423, S 3703,E17470,0425,100,200,300', { label: '10', continuation: false }));
		expect(result).toMatchObject({ title: 'Position report', coverage: 'partial' });
		expect(field(result, 'Latitude (raw)')).toBe('S 3703');
		expect(field(result, 'Longitude (raw)')).toBe('E 17470');
		expect(field(result, 'Header time code (raw)')).toBe('100423');
		expect(field(result, 'Additional fields (raw)')).toBe('0425,100,200,300');
		expect(result.fields.some((item) => /UTC|local|altitude|fuel/i.test(item.label))).toBe(false);
		expect(result.summary).not.toContain('°');
	});
	it.each([
		'POS100423,S3703',
		'POS100423,X3703,E17470,100',
		'POS100423,S3703,E17470,',
		'POS100423,S3703,E17470,100\ntrailing',
	])('rejects malformed POS layouts: %s', (text) => {
		expect(decode(record(1, text, { label: '10' })).coverage).toBe('unknown');
	});
	it('does not apply the POS layout to another label or direction', () => {
		const text = 'POS100423,S3703,E17470,100';
		expect(decode(record(1, text, { label: 'ZZ' })).coverage).toBe('unknown');
		expect(decode(record(1, text, { label: '10', direction: 'uplink' })).coverage).toBe('unknown');
	});
	it.each([apm, ker])('extracts header identifiers while retaining unverified dates and measurements', (text) => {
		const result = decode(record(1, text));
		expect(result.coverage).toBe('partial');
		expect(field(result, 'Reported registration')).toBe('B-1234');
		expect(field(result, 'Reported flight code')).toBe('CCA999');
		expect(field(result, 'Departure')).toBe('ZBAA · Beijing Capital International Airport');
		expect(field(result, 'Destination')).toBe('NZAA · Auckland International Airport');
		expect(field(result, 'Header date code (raw)')).toBe('091026');
		expect(field(result, 'Header time code (raw)')).toBe('232805');
		expect(result.fields.some((item) => /UTC|local|altitude|temperature|fuel/i.test(item.label))).toBe(false);
	});
	it('recognizes an APM first block and its complete assembly, preserving every raw block', () => {
		const blocks = [record(1, apm), record(2, '#DFB,4,5'), record(3, '#DFB,6', { continuation: false })];
		const results = decodeLog(blocks);
		expect(results[0].interpretation.title).toBe('Aircraft report APM');
		expect(results[1].interpretation.title).toBe('Aircraft report APM · block B');
		expect(field(results[1].interpretation, 'Reported registration (from first block)')).toBe('B-1234');
		expect(results[2].interpretation.title).toBe('Aircraft report APM');
		expect(results[2].assembledText).toBe(apm + ',4,5,6');
		expect(results.map((result) => result.text)).toEqual(blocks.map((block) => block.text));
	});
	it('does not recognize incomplete APM headers or headers from another H1 application', () => {
		for (const text of [apm.slice(0, 45), apm.replace('ZBAANZAA', 'ZBAA'), apm.replace('#DFB', '#MDB')])
			expect(decode(record(1, text)).coverage).toBe('unknown');
	});
	it('retains the KER report code when its optional flight and route header is truncated', () => {
		const result = decode(record(1, ker.slice(0, 45)));
		expect(result.coverage).toBe('partial');
		expect(field(result, 'Report code')).toBe('KER');
		expect(field(result, 'Reported registration')).toBeUndefined();
		expect(field(result, 'Departure')).toBeUndefined();
	});
});
