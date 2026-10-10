import { describe, expect, it } from 'vitest';
import { decode, decodeLog } from '@/api';

const input = (text, continuation = false) => ({ label: 'H1', text: '#DFB' + text, continuation });
const values = (result) => result.fields.filter((f) => f.label.startsWith('PR '));

describe('explicit PR records', () => {
	it('preserves identifiers, sign, decimal precision and repeated values without assigning units', () => {
		const text = ';PR29850.34880.36,55.24265;PR31851.36803.416,-15.855469;PR29850.34880.36,+55.242650';
		const original = input(text);
		const result = decode(original);
		expect(result.coverage).toBe('partial');
		expect(values(result)).toEqual([
			{ label: 'PR 29850.34880.36 (raw)', value: '55.24265' },
			{ label: 'PR 31851.36803.416 (raw)', value: '-15.855469' },
			{ label: 'PR 29850.34880.36 (raw)', value: '+55.242650' },
		]);
		expect(result.notes.join(' ')).toContain('No equipment name, scale or unit');
		expect(original.text).toBe('#DFB' + text);
	});
	it('extracts only semicolon-terminated records from an ETB fragment', () => {
		const result = decode(input('tail;PR29850.34880.36,55.24265;PR31851.36803.416,15', true));
		expect(values(result)).toHaveLength(1);
		expect(result.notes.join(' ')).toContain('split record');
	});
	it.each([
		'PR29850.34880.36,55',
		'PR29850.34880.36,NaN;',
		'XPR29850.34880.36,55;',
		'PR29850.34880,55;',
		'PR29850.34880.36,1.2.3;',
	])('withholds malformed/unterminated ETB records: %s', (text) => {
		expect(decode(input(text, true)).coverage).toBe('unknown');
	});
	it('bounds display output while retaining complete received text', () => {
		const original = input(Array.from({ length: 70 }, (_, i) => `PR29850.34880.36,${i}`).join(';'));
		const result = decode(original);
		expect(values(result)).toHaveLength(64);
		expect(result.notes.join(' ')).toContain('first 64');
		expect(original.text).toContain(',69');
	});
	it('does not apply PR parsing outside the DF application', () => {
		expect(decode({ label: 'H1', text: '#T6BPR29850.34880.36,55;' }).coverage).toBe('unknown');
	});
	it('does not replace a recognized report header with PR records found inside its body', () => {
		const result = decode(input('<102>KER9\r\n;PR29850.34880.36,55;'));
		expect(result.title).toBe('Aircraft report KER9');
		expect(result.fields.find((f) => f.label === 'Report ID')?.value).toBe('102');
	});
	it('reconstructs a split PR value only after every block arrives', () => {
		const records = [
			{ ...input(';PR29850.34880.36,55.', true), id: 1, receivedAt: 1000, registration: 'TEST', messageNumber: 'D01A' },
			{
				...input('24265;PR31851.36803.416,-15', false),
				id: 2,
				receivedAt: 2000,
				registration: 'TEST',
				messageNumber: 'D01B',
			},
		];
		const result = decodeLog(records);
		expect(result[0].interpretation.coverage).toBe('unknown');
		expect(values(result[1].interpretation)).toEqual([
			{ label: 'PR 29850.34880.36 (raw)', value: '55.24265' },
			{ label: 'PR 31851.36803.416 (raw)', value: '-15' },
		]);
		expect(result[1].assemblies[0].status).toBe('complete');
		expect(result.map((m) => m.text)).toEqual(records.map((m) => m.text));
	});
});
