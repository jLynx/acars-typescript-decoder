import { describe, expect, it } from 'vitest';
import { decode, decodeMetar, createDecoder, decodeLog } from '@/index';

const core = 'KJFK 100730Z 18005KT 9999 SCT020 18/12 A2992';
const parse = (suffix) => decodeMetar(`${core} ${suffix}`);
describe('documented METAR supplementary observations and remarks', () => {
	it('reads directional visibility without replacing prevailing visibility', () => {
		const r = decodeMetar('NZAA 100730Z 18005KT 9999 0800NE 1200SW SCT020 18/12 Q1018');
		expect(r.visibility.value).toBe(10000);
		expect(r.directionalVisibility).toEqual([
			{ value: 800, unit: 'm', direction: 'NE', raw: '0800NE' },
			{ value: 1200, unit: 'm', direction: 'SW', raw: '1200SW' },
		]);
		expect(r.complete).toBe(true);
	});
	it('keeps recent weather and runway shear separate from present weather', () => {
		const r = parse('RESHRA RETS WS R04L WS ALL RWY');
		expect(r.presentWeather).toEqual([]);
		expect(r.recentWeather.map((v) => v.description)).toEqual(['showers · rain', 'thunderstorm']);
		expect(r.windShear).toEqual([
			{ runway: '04L', raw: 'WS R04L' },
			{ runway: 'ALL', raw: 'WS ALL RWY' },
		]);
		expect(r.complete).toBe(true);
	});
	it.each(['WS R00', 'WS R37', 'WS ALL', 'REJUNK', 'RE', 'WS', 'WS RWYXX'])(
		'retains invalid supplementary group %s',
		(suffix) => {
			const r = parse(suffix);
			expect(r.complete).toBe(false);
			expect(r.unconsumed.length).toBeGreaterThan(0);
		},
	);
	it.each([
		[0, 1000],
		[499, 1049.9],
		[500, 950],
		[999, 999.9],
	])('reads sea-level pressure boundary %i', (code, value) => {
		const r = parse(`RMK AO2 SLP${String(code).padStart(3, '0')}`);
		expect(r.remarks.seaLevelPressure).toEqual({ value, unit: 'hPa' });
		expect(r.pressure).toEqual({ value: 29.92, unit: 'inHg' });
		expect(r.remarks.automation).toBe('AO2');
		expect(r.complete).toBe(true);
	});
	it('reads precise and period temperatures without overwriting body values', () => {
		const r = parse('RMK T10121056 10234 21056 402341056');
		expect(r.temperature.value).toBe(18);
		expect(r.dewpoint.value).toBe(12);
		expect(r.remarks.preciseTemperature).toEqual({ value: -1.2, unit: '°C' });
		expect(r.remarks.preciseDewpoint).toEqual({ value: -5.6, unit: '°C' });
		expect(r.remarks.temperatureExtrema.map((v) => [v.period, v.kind, v.temperature.value])).toEqual([
			['6-hour', 'maximum', 23.4],
			['6-hour', 'minimum', -5.6],
			['24-hour', 'maximum', 23.4],
			['24-hour', 'minimum', -5.6],
		]);
	});
	it('reads precipitation, snow and ice amounts with transmitted periods', () => {
		const r = parse('RMK P0012 60034 70056 4/008 I1001 I3012 I6023');
		expect(r.remarks.precipitation.map((v) => [v.period, v.amount.value, v.amount.unit])).toEqual([
			['1-hour', 0.12, 'in'],
			['3-or-6-hour', 0.34, 'in'],
			['24-hour', 0.56, 'in'],
		]);
		expect(r.remarks.snowDepth).toEqual({ value: 8, unit: 'in' });
		expect(r.remarks.iceAccretion.map((v) => [v.hours, v.depth.value])).toEqual([
			[1, 0.01],
			[3, 0.12],
			[6, 0.23],
		]);
	});
	it.each(Array.from({ length: 9 }, (_, i) => i))('retains 3-hour pressure magnitude and tendency %i', (code) => {
		const r = parse(`RMK 5${code}012`);
		expect(r.remarks.pressureChange).toMatchObject({
			period: '3-hour',
			tendencyCode: code,
			magnitude: { value: 1.2, unit: 'hPa' },
		});
		expect(r.remarks.pressureChange.tendency).toBeTruthy();
		expect(r.complete).toBe(true);
	});
	it('retains duplicate and unknown remarks without replacing valid values', () => {
		const suffix = 'RMK AO1 AO2 SLP182 SLP999 P0012 P9999 T0012 T2999 WSHFT 1230';
		const r = parse(suffix);
		expect(r.remarks.raw).toBe(suffix);
		expect(r.remarks.automation).toBe('AO1');
		expect(r.remarks.seaLevelPressure.value).toBe(1018.2);
		expect(r.remarks.precipitation[0].amount.value).toBe(0.12);
		expect(r.remarks.unconsumed).toEqual(['AO2', 'SLP999', 'P9999', 'T2999', 'WSHFT', '1230']);
		expect(r.complete).toBe(false);
	});
	it('does not read forecast or remark-like tokens outside their scope', () => {
		const r = parse('TEMPO 0800 BKN005 RMK SLP182');
		expect(r.remarks).toBeUndefined();
		expect(r.complete).toBe(false);
		expect(parse('SLP182').remarks).toBeUndefined();
	});
	it.each(['RA', 'C1', 'H1'])(
		'exposes typed remarks through %s dispatch and rejects malformed plugin values',
		(label) => {
			const result = decode({ label, text: `${core} RMK P0012 SLP182` });
			expect(result.weather[0].remarks.precipitation[0].amount.value).toBe(0.12);
			const valid = createDecoder({ plugins: [{ decode: () => result }] }).decode({ label: 'Q0', text: '' });
			expect(valid.weather[0].remarks.seaLevelPressure.value).toBe(1018.2);
			const invalid = structuredClone(result);
			invalid.weather[0].remarks.precipitation[0].amount.value = NaN;
			expect(
				createDecoder({ plugins: [{ decode: () => invalid }] }).decode({ label: 'Q0', text: '' }).weather,
			).toBeUndefined();
		},
	);
	it('waits for complete radio assembly and retains observation metadata', () => {
		const record = {
			id: 1,
			label: 'RA',
			registration: 'N123AB',
			messageNumber: 'M01A',
			text: `${core} RMK SLP`,
			continuation: true,
		};
		expect(decode(record).weather[0].complete).toBe(false);
		const log = decodeLog([record, { ...record, id: 2, messageNumber: 'M01B', text: '182', continuation: false }]);
		expect(log[1].interpretation.weather[0].remarks.seaLevelPressure.value).toBe(1018.2);
		expect(log[1].interpretation.weather[0].complete).toBe(true);
		expect(log[1].text).toBe('182');
	});
});
