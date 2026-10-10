import { describe, expect, it } from 'vitest';
import { decodeCpdlc } from '@/index';

const integer = (width, value) => value.toString(2).padStart(width, '0');
const text = (value) => [...value].map((char) => integer(7, char.charCodeAt(0))).join('');
const bytes = (binary) =>
	Uint8Array.from(binary.padEnd(Math.ceil(binary.length / 8) * 8, '0').match(/.{8}/g), (part) => parseInt(part, 2));
const flight = integer(3, 4) + text('ANZ123');
const route = '1100000000' + text('NZAA') + text('NZCH');
const edct = integer(5, 8) + integer(6, 30);
// FANSFrequencyDeparture aliases FANSFrequencyvhf directly; there is no CHOICE prefix.
const frequency = integer(15, 121900 - 117000);
const squawk = '001010011100';
const decode = (body, additional = '') =>
	decodeCpdlc(bytes((additional ? '1' : '0') + '00' + integer(6, 1) + integer(8, 73) + body + additional), 'uplink');

describe('FANS predeparture clearance UM73', () => {
	it('decodes required members, including revision 16 and compound message alignment', () => {
		const result = decode('000' + flight + edct + route + frequency + squawk + '1111', '00' + integer(8, 0));
		expect(result).toMatchObject({
			complete: true,
			summary:
				'PREDEPARTURE CLEARANCE ANZ123 · EDCT 08:30 UTC · departure NZAA · destination NZCH · departure frequency 121.900 MHz · squawk 1234 · revision 16 · UNABLE',
		});
	});
	it('reads all optional fields from their leading bitmap and equipment list', () => {
		const type = '10' + text('B738');
		const equipment = '11' + '0001' + '0101' + '1111' + '110';
		const altitude = '110' + integer(10, 350 - 30);
		const result = decode('111' + flight + type + equipment + edct + route + altitude + frequency + squawk + '0000');
		expect(result.complete).toBe(true);
		expect(result.summary).toContain('aircraft B738');
		expect(result.summary).toContain('(GNSS, VHF RTF); SSR Mode S pressure altitude and identification');
		expect(result.summary).toContain('altitude restriction FL350');
	});
	it('retains a truncated or invalid optional equipment body as partial', () => {
		expect(decode('010' + flight + '00' + '111').complete).toBe(false);
		expect(
			decode('000' + flight + integer(5, 24) + integer(6, 30) + route + frequency + squawk + '0000').complete,
		).toBe(false);
	});
});
