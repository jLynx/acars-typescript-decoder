import { describe, expect, it } from 'vitest';
import { decode, decodeLog, decodeMetar, createDecoder } from '@/index';
import { decodeMetar as formatsMetar } from '@/formats';

const core = 'NZAA 100730Z 24012G24KT 200V280 9999 -SHRA SCT020 BKN040CB 16/12 Q1018 NOSIG';
const parse = (text) => decodeMetar(text);

describe('documented core METAR fields in ACARS weather applications', () => {
	it('reads values and units through both public entry points', () => {
		for (const reader of [decodeMetar, formatsMetar]) {
			const result = reader(core);
			expect(result).toMatchObject({
				station: 'NZAA',
				day: 10,
				hour: 7,
				minute: 30,
				complete: true,
				wind: { direction: 240, speed: { value: 12, unit: 'kt' }, gust: { value: 24, unit: 'kt' } },
				windVariation: { from: 200, to: 280 },
				visibility: { value: 10000, unit: 'm', qualifier: 'at-least' },
				temperature: { value: 16, unit: '°C' },
				dewpoint: { value: 12, unit: '°C' },
				pressure: { value: 1018, unit: 'hPa' },
				noSignificantChange: true,
				integrity: 'unverified',
			});
			expect(result.clouds).toEqual([
				{ cover: 'SCT', height: { value: 2000, unit: 'ft' }, raw: 'SCT020' },
				{ cover: 'BKN', height: { value: 4000, unit: 'ft' }, type: 'CB', raw: 'BKN040CB' },
			]);
			expect(result.presentWeather[0]).toEqual({
				codes: ['-', 'SH', 'RA'],
				description: 'light · showers · rain',
				raw: '-SHRA',
			});
			expect(result.raw).toBe(core);
			expect(result.unconsumed).toEqual([]);
		}
	});
	it.each([
		['VRB03MPS', 'variable', 3, 'm/s'],
		['36015KMH', 360, 15, 'km/h'],
		['00000KT', 0, 0, 'kt'],
	])('retains wind %s without guessing units', (wind, direction, value, unit) => {
		expect(parse(`METAR NZAA 100730Z AUTO ${wind} CAVOK M05/M10 Q1000=`)).toMatchObject({
			kind: 'METAR',
			modifiers: ['AUTO'],
			wind: { direction, speed: { value, unit } },
			temperature: { value: -5 },
			dewpoint: { value: -10 },
			complete: true,
			cavok: true,
		});
	});
	it.each([
		['M1/4SM', 0.25, 'less-than'],
		['P6SM', 6, 'greater-than'],
		['1 1/2SM', 1.5, undefined],
		['10SM', 10, undefined],
	])('handles bounded/fractional visibility %s', (visibility, value, qualifier) => {
		const result = parse(`KJFK 100730Z 18005KT ${visibility} SKC 18/12 A2992`);
		expect(result.visibility).toEqual({ value, unit: 'SM', raw: visibility, ...(qualifier ? { qualifier } : {}) });
		expect(result.pressure).toEqual({ value: 29.92, unit: 'inHg' });
		expect(result.complete).toBe(true);
	});
	it('handles runway visibility, qualifiers, units and trend', () => {
		const result = parse('SPECI KJFK 100730Z COR 18005KT 0800 R04L/M0600VP1200FT/U +TSRA VV003 18/12 A2992');
		expect(result.kind).toBe('SPECI');
		expect(result.modifiers).toEqual(['COR']);
		expect(result.runwayVisibility).toEqual([
			{
				runway: '04L',
				minimum: { value: 600, unit: 'ft', qualifier: 'less-than' },
				maximum: { value: 1200, unit: 'ft', qualifier: 'greater-than' },
				tendency: 'increasing',
				raw: 'R04L/M0600VP1200FT/U',
			},
		]);
		expect(result.clouds[0].height.value).toBe(300);
		expect(result.complete).toBe(true);
	});
	it('does not decode trend or remark values into the current observation', () => {
		const suffix = 'TEMPO 12030G40KT 0800 BKN005 M10/M15 Q0990 RMK 1018';
		const result = parse(`NZAA 100730Z 24012KT CAVOK 16/12 Q1018 ${suffix}`);
		expect(result.wind.speed.value).toBe(12);
		expect(result.temperature.value).toBe(16);
		expect(result.pressure.value).toBe(1018);
		expect(result.unconsumed).toEqual([suffix]);
		expect(result.complete).toBe(false);
	});
	it.each(['Q1000', 'RMK AO2 SLPXYZ', 'XYZ', '36110KT', '1/0SM', 'R00/0600', 'RAJUNK'])(
		'retains unknown/duplicate groups: %s',
		(suffix) => {
			const result = parse(`${core} ${suffix}`);
			expect(result.complete).toBe(false);
			expect(result.pressure.value).toBe(1018);
			expect(result.unconsumed.length).toBeGreaterThan(0);
		},
	);
	it('keeps malformed first wind and missing values partial', () => {
		const result = parse('NZAA 100730Z 36110KT 9999 SCT020 ///// Q1018');
		expect(result.wind).toBeUndefined();
		expect(result.temperature).toBeUndefined();
		expect(result.dewpoint).toBeUndefined();
		expect(result.complete).toBe(false);
		expect(result.unconsumed).toContain('36110KT');
	});
	it('does not overwrite fields with groups received out of order', () => {
		const result = parse('NZAA 100730Z 24012KT 9999 SCT020 16/12 Q1018 18025KT');
		expect(result.wind.speed.value).toBe(12);
		expect(result.unconsumed).toEqual(['18025KT']);
	});
	it('retains CAVOK conflicts as partial', () => {
		expect(parse('NZAA 100730Z 24012KT CAVOK -RA BKN005 16/12 Q1018').complete).toBe(false);
	});
	it('retains missing cloud height and nil reports', () => {
		expect(parse('NZAA 100730Z 24012KT 0800 VV/// 16/12 Q1018').clouds[0].height).toBeNull();
		expect(parse('NZAA 100730Z NIL')).toMatchObject({ nil: true, complete: true, clouds: [], unconsumed: [] });
		expect(parse('NZAA 100730Z NIL EXTRA').complete).toBe(false);
	});
	it.each([
		'NZAA 000730Z 24012KT',
		'NZAA 322430Z 24012KT',
		'NZAA 102460Z 24012KT',
		'NZAA 100760Z 24012KT',
		'NZ 100730Z 24012KT',
		'NZAA 100730 24012KT',
		'x'.repeat(8193),
	])('rejects invalid headers/bounds', (text) => expect(parse(text)).toBeUndefined());
	it('bounds token count and leaves caller data untouched', () => {
		expect(parse(`NZAA 100730Z ${'X '.repeat(513)}`)).toBeUndefined();
		const input = Object.freeze({ label: 'RA', text: core });
		expect(decode(input).weather[0].raw).toBe(core);
		expect(input.text).toBe(core);
	});
	it('retains ETB observations as incomplete and rejects malformed plugin measurements', () => {
		expect(decode({ label: 'RA', text: core, continuation: true }).weather[0].complete).toBe(false);
		const result = decode({ label: 'RA', text: core });
		const valid = createDecoder({ plugins: [{ decode: () => result }] }).decode({ label: 'Q0', text: '' });
		expect(valid.weather[0].pressure.value).toBe(1018);
		const invalid = structuredClone(result);
		invalid.weather[0].pressure.value = NaN;
		expect(createDecoder({ plugins: [{ decode: () => invalid }] }).decode({ label: 'Q0', text: '' }).title).toBe(
			'Link test',
		);
	});
	it('routes direct H1 and ordinary weather messages through the dispatcher', () => {
		for (const [label, text] of [
			['RA', core],
			['C1', core],
			['H1', `- #M1${core}`],
		]) {
			const result = decode({ label, text, direction: 'uplink' });
			expect(result.title).toBe('Aerodrome weather report');
			expect(result.weather[0].pressure.value).toBe(1018);
			expect(result.coverage).toBe('decoded');
		}
	});
	it('decodes both SA bundle reports from the pinned datalink fixture', () => {
		const text =
			'QUGTWLSXA~1\r\nSA 30/15:34\r\nLFRS 301530Z AUTO 25009KT CAVOK\r\n  28/20 Q1018 NOSIG\r\nSA 30/15:08\r\nLEMD 301500Z 22012KT CAVOK 36/05 Q1018 NOSIG';
		const result = decode({ label: 'RA', text, direction: 'uplink' });
		expect(result.weather.map((report) => report.station)).toEqual(['LFRS', 'LEMD']);
		expect(result.weather[0]).toMatchObject({
			wind: { speed: { value: 9, unit: 'kt' } },
			temperature: { value: 28 },
			pressure: { value: 1018 },
		});
		expect(result.weather[1].temperature.value).toBe(36);
		expect(result.fields.find((item) => item.label === 'Altimeter pressure 1').value).toBe('1018 hPa');
		expect(result.coverage).toBe('partial');
	});
	it('decodes after complete radio assembly and retains originals', () => {
		const common = {
			label: 'H1',
			registration: 'ZK-TEST',
			flight: 'NZ123',
			mode: '2',
			receivedAt: 1000,
			direction: 'downlink',
		};
		const result = decodeLog([
			{ ...common, id: 1, text: '#M1BNZAA 100730Z 24012KT CAVOK 16/', messageNumber: 'M01A', continuation: true },
			{ ...common, id: 2, text: '#M1B12 Q1018', messageNumber: 'M01B', continuation: false, receivedAt: 1001 },
		]);
		expect(result[1].interpretation.weather[0].temperature.value).toBe(16);
		expect(result[1].interpretation.weather[0].dewpoint.value).toBe(12);
		expect(result[1].text).toBe('#M1B12 Q1018');
	});
});
