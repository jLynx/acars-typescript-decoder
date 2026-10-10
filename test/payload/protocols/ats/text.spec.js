import { describe, expect, it } from 'vitest';
import { decode, createDecoder } from '@/index';
import { airportName } from '@/airports';

const field = (result, label) => result.fields.find((item) => item.label === label)?.value;
const afn = '/EGTT.AFN/FMHBAW50G,.G-YMMG,4007F2,154626/FPON51283W000285,1/FCOADS,01/FCOATC,01CB69';
const reply = '/YVRE2YA.AFN/FMHASA824,.N391HA,,154951/FAK0,CZVR/FARADS,0/FARATC,0,YVRE2YAA870';
const parse = (label, text, direction = 'downlink') => decode({ label, text, direction });

describe('ATS text application ports from pinned MIT datalink', () => {
	it('ports the AFN contact test and every original asserted field', () => {
		const result = parse('B0', afn);
		expect(result.application.values).toMatchObject({
			facility: 'EGTT',
			messageType: 'FMH',
			flight: 'BAW50G',
			registration: 'G-YMMG',
			icao24: '4007F2',
		});
		expect(result.application.values.applications).toEqual(['FCO ADS 01', 'FCO ATC 01']);
		expect(result.application.integrity).toEqual({ status: 'unverified', checksum: 'CB69' });
		expect(result.application.raw).toBe(afn);
		expect(result.coverage).toBe('partial');
		expect(field(result, 'AFN position (raw)')).toBe('N51283W000285');
	});
	it('ports the uplink AFN payload fixture and preserves unknown acknowledgement sections', () => {
		const result = parse('A0', reply, 'uplink');
		expect(result.application.values).toMatchObject({
			facility: 'YVRE2YA',
			messageType: 'FMH',
			registration: 'N391HA',
		});
		expect(result.application.values.applications).toHaveLength(2);
		expect(result.application.unconsumed).toEqual(['FAK0,CZVR']);
		expect(result.application.values.icao24).toBeUndefined();
	});
	it.each([
		['/EHAM.TI2/000EHAMA0E3C', 'EHAM', 'A', 0, '0E3C'],
		['/EGCC.TI2/040EGCCA567B', 'EGCC', 'A', 40, '567B'],
		['J41ATK0059/LTFM.TI2/000LTFMA7745', 'LTFM', 'A', 0, '7745'],
		['/ZHHH.TI2/040ZHHHD9F98', 'ZHHH', 'D', 40, '9F98'],
	])('ports upstream B9 test %s', (text, airport, currentAtis, offset, checksum) => {
		const result = parse('B9', text);
		expect(result.application.values).toEqual({ airport, currentAtis, offset });
		expect(result.application.integrity.checksum).toBe(checksum);
		expect(result.coverage).toBe('partial');
	});
	it.each([
		'SOMEGARBAGETEXT',
		'/EHA.TI2/000EHAMA0E3C',
		'/EHAM.TI2/000EGCCA0E3C',
		'/EHAM.TI2/000EHAM10E3C',
		'/EHAM.TI2/000EHAMA0E3Cjunk',
	])('rejects invalid B9 layout %s', (text) => {
		expect(parse('B9', text).application).toBeUndefined();
	});
	it('does not apply B9 downlink requests to uplinks', () => {
		expect(parse('B9', '/EHAM.TI2/000EHAMA0E3C', 'uplink').application).toBeUndefined();
	});
	it('ports the A9 payload expectations without stripping weather tokens as checksums', () => {
		const text = '/JEDATYA.TI2/OEMA ARR ATIS S\n1500Z WIND 220/11KT\nQNH 1009HPA\n40A4';
		const result = parse('A9', text, 'uplink');
		expect(result.application.values).toMatchObject({ airport: 'OEMA', atisLetter: 'S', issuedTime: '1500Z' });
		expect(result.application.integrity.checksum).toBe('40A4');
		expect(result.application.values.text).toContain('QNH 1009HPA');
		const noChecksum = parse('A9', '/ATSU.TI2/NZAA DEP ATIS A\n0530Z WIND 120/5KT Q1018', 'uplink');
		expect(noChecksum.application.integrity.checksum).toBeUndefined();
		expect(noChecksum.application.values.text).toContain('Q1018');
	});
	it.each(['\r\n', '\\r\\n'])('ports oceanic requests with actual or escaped line breaks', (separator) => {
		const text = ['/EGGX.OC1/RCL 030', 'BAW71K-BALIX/1628 M084F360', '-RMK/MAX F3805082'].join(separator);
		const result = parse('B1', text, 'uplink');
		expect(result.application.values).toMatchObject({
			facility: 'EGGX',
			clearanceType: 'RCL',
			clearanceNumber: '030',
			flight: 'BAW71K',
			entryPoint: 'BALIX',
			entryTime: '1628',
			mach: 0.84,
			flightLevel: 360,
			remarks: 'MAX F3805082',
		});
		expect(result.application.raw).toBe(text);
	});
	it('enriches display fields while retaining machine-readable airport codes', () => {
		const result = createDecoder({ airportLookup: airportName }).decode({
			label: 'B9',
			text: '/EHAM.TI2/000EHAMA0E3C',
		});
		expect(field(result, 'Requested airport (ICAO)')).toContain('Amsterdam');
		expect(result.application.values.airport).toBe('EHAM');
	});
	it('decodes AFN inside an H1 envelope and rejects truncated contacts', () => {
		expect(parse('H1', '#MDB' + afn).application.values.registration).toBe('G-YMMG');
		for (const text of [afn.slice(0, 30), afn.replace('4007F2', 'invalid'), afn.replace('CB69', 'ZZZZ')])
			expect(parse('B0', text).application).toBeUndefined();
	});
});
