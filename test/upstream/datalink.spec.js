import { describe, expect, it } from 'vitest';
import { decode, decodeCpdlc } from '@/index';
import fixtures from './datalink.json';

const field = (result, name) => result.fields.find((item) => item.label === name)?.value;
describe('ported datalink ACARS payload assertions', () => {
	it.each(fixtures.fixtures.acars_payloads)('$name', (fixture) => {
		const result = decode(fixture);
		const expected = fixture.expect;
		expect(result.coverage).not.toBe('unknown');
		const values = result.application?.values;
		if (expected.variant === 'AtisDelivery')
			expect(values).toMatchObject({
				airport: expected.airport,
				atisLetter: expected.atis_letter,
				issuedTime: expected.issued_time,
			});
		if (expected.variant === 'Afn') {
			expect(values).toMatchObject({
				facility: expected.facility,
				messageType: expected.message_type,
				registration: expected.registration,
			});
			expect(values.applications).toHaveLength(expected.app_count);
			if (expected.icao24) expect(values.icao24).toBe(expected.icao24);
		}
		if (expected.variant === 'OceanicClearance')
			expect(values).toMatchObject({
				facility: expected.facility,
				clearanceType: expected.clearance_type,
				flight: expected.flight_id,
				entryPoint: expected.entry_point,
			});
		if (expected.variant === 'Weather') {
			expect(result.fields.filter((item) => item.label.startsWith('Weather station'))).toHaveLength(
				expected.report_count,
			);
			expect(field(result, 'Weather station 1')).toBe(expected.first_station);
		}
		if (expected.variant === 'Label5z') {
			expect(field(result, `${expected.key} (raw)`)).toBe(expected.value);
			expect(result.fields.filter((item) => item.label.endsWith('(raw)'))).toHaveLength(expected.field_count);
		}
		if (expected.variant === 'AocPosition') {
			if (expected.lat !== undefined) expect(field(result, 'Latitude')).toBe(`${expected.lat}°`);
			if (expected.lon !== undefined) expect(field(result, 'Longitude')).toBe(`${expected.lon}°`);
			if (expected.departure) expect(field(result, 'Origin') ?? field(result, 'Departure')).toBe(expected.departure);
			if (expected.destination) expect(field(result, 'Destination')).toBe(expected.destination);
			if (expected.lat_min)
				expect(Number(field(result, 'Aircraft Position').split(' ')[0])).toBeGreaterThan(expected.lat_min);
			if (expected.lon_max)
				expect(-Number(field(result, 'Aircraft Position').split(', ')[1].split(' ')[0])).toBeLessThan(expected.lon_max);
		}
		if (expected.variant === 'Label32') {
			expect(field(result, 'Latitude')).toBe(`${expected.lat}°`);
			expect(field(result, 'Longitude')).toBe(`${expected.lon}°`);
			expect(field(result, 'Altitude')).toBe(`${expected.altitude} ft`);
			expect(field(result, 'Reported date/time')).toContain(expected.timestamp);
		}
		if (expected.variant === 'Label16') {
			expect(field(result, 'Time code (raw)')).toBe(expected.timestamp);
			expect(field(result, 'Field count')).toBe(String(expected.field_count));
		}
		if (expected.variant === 'Label37') {
			expect(field(result, 'Prefix (raw)')).toBe(expected.prefix);
			expect(field(result, 'Line count')).toBe(String(expected.line_count));
		}
	});
});

describe('ported datalink ADS-C fixtures with integrity enforcement', () => {
	it.each(fixtures.fixtures.adsc.filter((fixture) => fixture.kind === 'message'))('$name', (fixture) => {
		const result = decode({ label: 'B6', text: fixture.text });
		expect(field(result, 'Ground address')).toBe(fixture.expect.atsu);
		expect(field(result, 'Aircraft address')).toBe(fixture.expect.registration);
		if (fixture.name === 'libacars_adsc_2') {
			expect(field(result, 'Application CRC')).toContain('Failed');
			expect(field(result, 'Latitude')).toBeUndefined();
		} else {
			expect(field(result, 'Application CRC')).toContain('Verified');
			expect(result.coverage).toBe('decoded');
		}
	});
	it('retains the original shallow CPDLC corpus and independently decodes over 200 complete PDUs', () => {
		const corpus = fixtures.fixtures.cpdlc.filter((fixture) => fixture.kind === 'corpus');
		expect(corpus).toHaveLength(260);
		let interpreted = 0;
		for (const fixture of corpus) {
			const bytes = Uint8Array.from(Buffer.from(fixture.payload_hex, 'hex'));
			const before = bytes.slice();
			const complete = ['uplink', 'downlink'].some((direction) => {
				try {
					return decodeCpdlc(bytes, direction).complete;
				} catch {
					return false;
				}
			});
			if (complete) interpreted++;
			expect(bytes).toEqual(before);
		}
		expect(interpreted).toBeGreaterThan(200);
	});
	it('decodes an empty, CRC-verified disconnect request', () => {
		const fixture = fixtures.fixtures.cpdlc.find(
			(row) => row.kind === 'control' && row.expect === 'disconnect_request',
		);
		expect(decode({ label: 'BA', ...fixture }).coverage).toBe('decoded');
	});
});
