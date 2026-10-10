// Named scales from pinned Doc9705 ATN CPDLC ASN.1 comments; no plausible-value inference.
import type { AtnCpdlcValue } from './cpdlc.types';

const definitions: Record<string, [number, string, string?]> = {
	LevelFeet: [10, 'ft'],
	LevelMeters: [1, 'm'],
	LevelFlightLevel: [1, 'flight-level', '100 ft'],
	LevelFlightLevelMetric: [1, 'metric-flight-level', '10 m'],
	LatitudeDegrees: [0.001, 'degree'],
	LongitudeDegrees: [0.001, 'degree'],
	LatitudeWholeDegrees: [1, 'degree'],
	LongitudeWholeDegrees: [1, 'degree'],
	MinutesLatLon: [0.01, 'arcminute'],
	LatLonWholeMinutes: [1, 'arcminute'],
	SecondsLatLon: [1, 'arcsecond'],
	DegreesMagnetic: [1, 'degree', 'magnetic'],
	DegreesTrue: [1, 'degree', 'true'],
	DistanceNm: [0.1, 'NM'],
	DistanceKm: [0.25, 'km'],
	DistanceSpecifiedNm: [1, 'NM'],
	DistanceSpecifiedKm: [1, 'km'],
	SpeedIndicated: [1, 'kt', 'indicated'],
	SpeedIndicatedMetric: [1, 'km/h', 'indicated'],
	SpeedTrue: [1, 'kt', 'true'],
	SpeedTrueMetric: [1, 'km/h', 'true'],
	SpeedGround: [1, 'kt', 'ground'],
	SpeedGroundMetric: [1, 'km/h', 'ground'],
	SpeedMach: [0.001, 'Mach'],
	Frequencyhf: [1, 'kHz'],
	Frequencyvhf: [0.005, 'MHz'],
	Frequencyuhf: [0.025, 'MHz'],
	DepartureMinimumInterval: [0.1, 'min'],
	LegDistanceEnglish: [1, 'NM'],
	LegDistanceMetric: [1, 'km'],
	LegTime: [1, 'min'],
	AltimeterEnglish: [0.01, 'inHg'],
	AltimeterMetric: [0.1, 'hPa'],
	VerticalRateEnglish: [10, 'ft/min'],
	VerticalRateMetric: [10, 'm/min'],
	RVRFeet: [1, 'ft'],
	RVRMeters: [1, 'm'],
	DegreeIncrement: [1, 'degree'],
	RTATolerance: [0.1, 'min'],
	Temperature: [1, '°C'],
	WindDirection: [1, 'degree'],
	WindSpeedEnglish: [1, 'kt'],
	WindSpeedMetric: [1, 'km/h'],
	Humidity: [1, '%'],
};

export function annotateAtnMeasurements(value: AtnCpdlcValue): void {
	const definition = definitions[value.type];
	if (definition && typeof value.value === 'number') {
		const [scale, unit, reference] = definition;
		value.measurement = {
			value: Number((value.value * scale).toFixed(10)),
			scale,
			unit,
			...(reference ? { reference } : {}),
		};
	}
	for (const child of value.children ?? []) annotateAtnMeasurements(child);
}
