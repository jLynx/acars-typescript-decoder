import { isRecord } from '@/validation';

const units = ['kt', 'm/s', 'km/h', 'm', 'SM', 'ft', '°C', 'hPa', 'inHg', 'in'];
function quantity(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.value === 'number' &&
		Number.isFinite(value.value) &&
		units.includes(String(value.unit)) &&
		(value.qualifier === undefined ||
			(typeof value.qualifier === 'string' && ['less-than', 'greater-than', 'at-least'].includes(value.qualifier)))
	);
}
const strings = (value: unknown) =>
	Array.isArray(value) && value.length <= 512 && value.every((item: unknown) => typeof item === 'string');
function records(value: unknown, check: (item: Record<string, unknown>) => boolean): boolean {
	return Array.isArray(value) && value.length <= 512 && value.every((item: unknown) => isRecord(item) && check(item));
}
function wind(value: unknown): boolean {
	return (
		isRecord(value) &&
		(value.direction === null || value.direction === 'variable' || integer(value.direction, 0, 360)) &&
		quantity(value.speed) &&
		(value.gust === undefined || quantity(value.gust)) &&
		typeof value.raw === 'string'
	);
}
const integer = (value: unknown, minimum: number, maximum: number) =>
	typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

function header(value: Record<string, unknown>): boolean {
	return (
		typeof value.raw === 'string' &&
		value.raw.length <= 8192 &&
		typeof value.station === 'string' &&
		/^[A-Z][A-Z0-9]{3}$/.test(value.station) &&
		integer(value.day, 1, 31) &&
		integer(value.hour, 0, 23) &&
		integer(value.minute, 0, 59) &&
		strings(value.modifiers) &&
		strings(value.unconsumed) &&
		['nil', 'cavok', 'complete', 'noSignificantChange'].every((key) => typeof value[key] === 'boolean')
	);
}

function report(value: unknown): boolean {
	if (!isRecord(value) || value.protocol !== 'METAR' || value.integrity !== 'unverified' || !header(value))
		return false;
	if (value.wind !== undefined && !wind(value.wind)) return false;
	if (!extensions(value)) return false;
	if (
		value.windVariation !== undefined &&
		(!isRecord(value.windVariation) ||
			!integer(value.windVariation.from, 0, 360) ||
			!integer(value.windVariation.to, 0, 360))
	)
		return false;
	if (
		!['visibility', 'temperature', 'dewpoint', 'pressure'].every(
			(key) => value[key] === undefined || quantity(value[key]),
		)
	)
		return false;
	return (
		records(
			value.clouds,
			(item) =>
				typeof item.cover === 'string' &&
				typeof item.raw === 'string' &&
				(item.height === null || quantity(item.height)),
		) &&
		records(
			value.presentWeather,
			(item) => strings(item.codes) && typeof item.description === 'string' && typeof item.raw === 'string',
		) &&
		records(
			value.runwayVisibility,
			(item) =>
				typeof item.runway === 'string' &&
				typeof item.raw === 'string' &&
				quantity(item.minimum) &&
				(item.maximum === undefined || quantity(item.maximum)),
		) &&
		isRecord(value.source) &&
		typeof value.source.repository === 'string' &&
		typeof value.source.revision === 'string' &&
		strings(value.source.files)
	);
}

function extensions(value: Record<string, unknown>): boolean {
	return (
		(value.directionalVisibility === undefined ||
			records(
				value.directionalVisibility,
				(item) => quantity(item) && typeof item.direction === 'string' && typeof item.raw === 'string',
			)) &&
		(value.recentWeather === undefined ||
			records(
				value.recentWeather,
				(item) => strings(item.codes) && typeof item.description === 'string' && typeof item.raw === 'string',
			)) &&
		(value.windShear === undefined ||
			records(value.windShear, (item) => typeof item.runway === 'string' && typeof item.raw === 'string')) &&
		(value.remarks === undefined || remarks(value.remarks))
	);
}

function remarks(value: unknown): boolean {
	if (!isRecord(value) || typeof value.raw !== 'string' || !strings(value.unconsumed)) return false;
	if (
		value.automation !== undefined &&
		(typeof value.automation !== 'string' || !['AO1', 'AO2'].includes(value.automation))
	)
		return false;
	if (
		!['seaLevelPressure', 'preciseTemperature', 'preciseDewpoint', 'snowDepth'].every(
			(key) => value[key] === undefined || quantity(value[key]),
		)
	)
		return false;
	if (
		value.pressureChange !== undefined &&
		(!isRecord(value.pressureChange) ||
			value.pressureChange.period !== '3-hour' ||
			!quantity(value.pressureChange.magnitude) ||
			!integer(value.pressureChange.tendencyCode, 0, 8) ||
			typeof value.pressureChange.tendency !== 'string' ||
			typeof value.pressureChange.raw !== 'string')
	)
		return false;
	return (
		records(
			value.precipitation,
			(item) =>
				['1-hour', '3-or-6-hour', '24-hour'].includes(String(item.period)) &&
				quantity(item.amount) &&
				typeof item.raw === 'string',
		) &&
		records(
			value.temperatureExtrema,
			(item) =>
				['6-hour', '24-hour'].includes(String(item.period)) &&
				['maximum', 'minimum'].includes(String(item.kind)) &&
				quantity(item.temperature) &&
				typeof item.raw === 'string',
		) &&
		records(
			value.iceAccretion,
			(item) => [1, 3, 6].includes(Number(item.hours)) && quantity(item.depth) && typeof item.raw === 'string',
		)
	);
}

export function validWeatherReports(value: unknown): boolean {
	return Array.isArray(value) && value.length <= 64 && value.every(report);
}
