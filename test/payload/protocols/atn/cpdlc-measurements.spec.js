import { describe, expect, it } from 'vitest';
import { decodeAtnCpdlc } from '@/index';
import { wire, find } from './cpdlc-wire';

// Independent named-value expectations from Doc9705 ASN.1 comments, not production scales.
const expectations = [
	['LevelFeet', 3500, 35000, 'ft'],
	['LevelFeet', -60, -600, 'ft'],
	['LevelMeters', -30, -30, 'm'],
	['LevelFlightLevel', 350, 350, 'flight-level'],
	['LevelFlightLevelMetric', 1000, 1000, 'metric-flight-level'],
	['LatitudeDegrees', 45678, 45.678, 'degree'],
	['LongitudeDegrees', 123456, 123.456, 'degree'],
	['LatitudeWholeDegrees', 45, 45, 'degree'],
	['LongitudeWholeDegrees', 179, 179, 'degree'],
	['MinutesLatLon', 5999, 59.99, 'arcminute'],
	['LatLonWholeMinutes', 59, 59, 'arcminute'],
	['SecondsLatLon', 59, 59, 'arcsecond'],
	['DegreesMagnetic', 360, 360, 'degree'],
	['DegreesTrue', 90, 90, 'degree'],
	['DistanceNm', 1, 0.1, 'NM'],
	['DistanceKm', 1, 0.25, 'km'],
	['DistanceSpecifiedNm', 250, 250, 'NM'],
	['DistanceSpecifiedKm', 500, 500, 'km'],
	['SpeedIndicated', 250, 250, 'kt'],
	['SpeedIndicatedMetric', 400, 400, 'km/h'],
	['SpeedTrue', 450, 450, 'kt'],
	['SpeedTrueMetric', 800, 800, 'km/h'],
	['SpeedGround', -50, -50, 'kt'],
	['SpeedGroundMetric', -100, -100, 'km/h'],
	['SpeedMach', 837, 0.837, 'Mach'],
	['Frequencyhf', 2850, 2850, 'kHz'],
	['Frequencyvhf', 23601, 118.005, 'MHz'],
	['Frequencyuhf', 9001, 225.025, 'MHz'],
	['DepartureMinimumInterval', 1, 0.1, 'min'],
	['LegDistanceEnglish', 50, 50, 'NM'],
	['LegDistanceMetric', 128, 128, 'km'],
	['LegTime', 10, 10, 'min'],
	['AltimeterEnglish', 2992, 29.92, 'inHg'],
	['AltimeterMetric', 10132, 1013.2, 'hPa'],
	['VerticalRateEnglish', 123, 1230, 'ft/min'],
	['VerticalRateMetric', 123, 1230, 'm/min'],
	['RVRFeet', 6100, 6100, 'ft'],
	['RVRMeters', 1500, 1500, 'm'],
	['DegreeIncrement', 20, 20, 'degree'],
	['RTATolerance', 150, 15, 'min'],
	['Temperature', -50, -50, '°C'],
	['WindDirection', 360, 360, 'degree'],
	['WindSpeedEnglish', 123, 123, 'kt'],
	['WindSpeedMetric', 511, 511, 'km/h'],
	['Humidity', 100, 100, '%'],
];

describe('documented ATN CPDLC version 1 scalar units', () => {
	it.each(expectations)('interprets %s constrained %i as %s %s', (type, value, measurement, unit) => {
		const fixture = wire(type, value),
			result = decodeAtnCpdlc(fixture.bytes, fixture.options);
		const node = find(result.value, type);
		expect(node.value).toBe(value);
		expect(node.measurement).toMatchObject({ value: measurement, unit });
		expect(result.integrity).toBe('unverified');
	});
	it('retains distinct true/magnetic and level references', () => {
		for (const [type, reference] of [
			['DegreesMagnetic', 'magnetic'],
			['DegreesTrue', 'true'],
			['LevelFlightLevel', '100 ft'],
			['LevelFlightLevelMetric', '10 m'],
		]) {
			const fixture = wire(type),
				result = decodeAtnCpdlc(fixture.bytes, fixture.options);
			expect(find(result.value, type).measurement.reference).toBe(reference);
		}
	});
});
