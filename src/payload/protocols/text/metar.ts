import type { AcarsField, AcarsInterpretation } from '@/payload/types';
import type { MetarReport, MetarQuantity, MetarGroup } from './metar/types';
import { readMetarGroup } from './metar/groups';
import { readMetarRemarks } from './metar/remarks';

/** Decode the supported core observation; no month/year or application CRC is inferred. */
export function decodeMetar(text: string): MetarReport | undefined {
	if (typeof text !== 'string' || text.length > 8192) return;
	const tokens = text.trim().replace(/=$/, '').trim().split(/\s+/);
	const kind = ['METAR', 'SPECI'].includes(tokens[0]) ? (tokens.shift() as 'METAR' | 'SPECI') : undefined;
	const modifiers: string[] = [];
	if (tokens[0] === 'COR') modifiers.push(tokens.shift()!);
	const station = tokens.shift();
	const clock = /^(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])([0-5]\d)Z$/.exec(tokens.shift() ?? '');
	if (!station || !/^[A-Z][A-Z0-9]{3}$/.test(station) || !clock || tokens.length > 512) return;
	while (['AUTO', 'COR'].includes(tokens[0])) modifiers.push(tokens.shift()!);
	const report: MetarReport = {
		protocol: 'METAR',
		raw: text,
		station,
		kind,
		day: Number(clock[1]),
		hour: Number(clock[2]),
		minute: Number(clock[3]),
		modifiers,
		nil: tokens[0] === 'NIL',
		cavok: false,
		clouds: [],
		presentWeather: [],
		recentWeather: [],
		windShear: [],
		directionalVisibility: [],
		runwayVisibility: [],
		noSignificantChange: false,
		unconsumed: [],
		complete: false,
		integrity: 'unverified',
		source: {
			repository: 'https://github.com/python-metar/python-metar',
			revision: '281fb19e4f8870074844cba5e4b390a1f5fe7c6e',
			files: ['metar/Metar.py'],
		},
	};
	if (report.nil) {
		report.unconsumed = tokens.slice(1);
		report.complete = tokens.length === 1;
		return report;
	}
	readObservation(tokens, report);
	return report;
}

function readObservation(tokens: string[], report: MetarReport): void {
	let rank = 0;
	const seen = new Set<string>();
	for (let index = 0; index < tokens.length; index++) {
		let token = tokens[index];
		if (token === 'RMK' || token === 'RMKS') {
			report.remarks = readMetarRemarks(tokens.slice(index).join(' '));
			if (report.remarks.unconsumed.length) report.unconsumed.push(...report.remarks.unconsumed);
			break;
		}
		if (['TEMPO', 'BECMG', 'NOSIG'].includes(token)) {
			if (token === 'NOSIG' && index === tokens.length - 1) report.noSignificantChange = true;
			else report.unconsumed.push(tokens.slice(index).join(' '));
			break;
		}
		if (/^\d+$/.test(token) && /^\d+\/\d+SM$/.test(tokens[index + 1] ?? '')) token += ` ${tokens[++index]}`;
		if (token === 'WS') {
			token += ` ${tokens[++index] ?? ''}`;
			if (token === 'WS ALL') token += ` ${tokens[++index] ?? ''}`;
		}
		const group = readMetarGroup(token);
		if (!acceptable(group, rank, seen, report)) {
			report.unconsumed.push(token);
			continue;
		}
		rank = group.rank;
		seen.add(group.key);
		if (group.append) (report[group.key] as unknown[]).push(group.value);
		else Object.assign(report, { [group.key]: group.value });
		Object.assign(report, group.additional);
	}
	report.complete = completeObservation(report, seen);
}

function acceptable(
	group: MetarGroup | undefined,
	rank: number,
	seen: Set<string>,
	report: MetarReport,
): group is MetarGroup {
	return Boolean(
		group &&
		group.rank >= rank &&
		(group.append || !seen.has(group.key)) &&
		(group.key !== 'windVariation' || report.wind) &&
		(group.key !== 'directionalVisibility' || report.visibility),
	);
}

function completeObservation(report: MetarReport, seen: Set<string>): boolean {
	const conflict =
		report.cavok &&
		(report.clouds.length > 0 || report.presentWeather.length > 0 || report.runwayVisibility.length > 0);
	return (
		!conflict &&
		report.unconsumed.length === 0 &&
		Boolean(
			report.wind &&
			report.visibility &&
			(report.cavok || report.clouds.length) &&
			seen.has('temperature') &&
			report.pressure,
		)
	);
}

const displayQuantity = (value: MetarQuantity) =>
	`${value.qualifier ? { 'less-than': '<', 'greater-than': '>', 'at-least': '≥' }[value.qualifier] : ''}${value.value} ${value.unit}`;

export function metarFields(report: MetarReport): AcarsField[] {
	const fields: AcarsField[] = [
		{ label: 'Weather station', value: report.station },
		{
			label: 'Observation time',
			value: `Day ${report.day} · ${String(report.hour).padStart(2, '0')}:${String(report.minute).padStart(2, '0')} UTC (month/year not supplied)`,
		},
	];
	if (report.nil) return [...fields, { label: 'Observation', value: 'NIL · report unavailable' }];
	if (report.wind)
		fields.push({
			label: 'Wind',
			value: `${report.wind.direction === 'variable' ? 'Variable' : report.wind.direction === null ? 'Direction unavailable' : `${report.wind.direction}° true`} · ${displayQuantity(report.wind.speed)}${report.wind.gust ? ` · gust ${displayQuantity(report.wind.gust)}` : ''}`,
		});
	if (report.windVariation)
		fields.push({ label: 'Wind variation', value: `${report.windVariation.from}°–${report.windVariation.to}° true` });
	if (report.visibility) fields.push({ label: 'Visibility', value: displayQuantity(report.visibility) });
	if (report.cavok)
		fields.push({
			label: 'CAVOK',
			value: 'Visibility at least 10 km · no significant weather or operationally significant cloud reported',
		});
	for (const layer of report.clouds.slice(0, 16))
		fields.push({
			label: 'Cloud',
			value: `${layer.cover}${layer.height ? ` · ${displayQuantity(layer.height)} above aerodrome` : ' · height unavailable or not supplied'}${layer.type ? ` · ${layer.type}` : ''}`,
		});
	for (const weather of report.presentWeather.slice(0, 8))
		fields.push({ label: 'Present weather', value: weather.description });
	fields.push(...supplementaryFields(report));
	for (const runway of report.runwayVisibility.slice(0, 8))
		fields.push({
			label: `Runway ${runway.runway} visibility`,
			value: `${displayQuantity(runway.minimum)}${runway.maximum ? ` to ${displayQuantity(runway.maximum)}` : ''}${runway.tendency ? ` · ${runway.tendency}` : ''}`,
		});
	for (const [label, value] of [
		['Temperature', report.temperature],
		['Dew point', report.dewpoint],
		['Altimeter pressure', report.pressure],
	] as const)
		if (value) fields.push({ label, value: displayQuantity(value) });
	if (report.noSignificantChange) fields.push({ label: 'Trend', value: 'NOSIG · no significant change' });
	return fields;
}

function supplementaryFields(report: MetarReport): AcarsField[] {
	const fields: AcarsField[] = [];
	for (const visibility of report.directionalVisibility ?? [])
		fields.push({ label: 'Directional visibility', value: `${visibility.direction} · ${displayQuantity(visibility)}` });
	for (const weather of report.recentWeather ?? [])
		fields.push({ label: 'Recent weather', value: weather.description });
	for (const shear of report.windShear ?? [])
		fields.push({ label: 'Wind shear', value: shear.runway === 'ALL' ? 'All runways' : `Runway ${shear.runway}` });
	if (report.remarks) fields.push({ label: 'Weather remarks', value: report.remarks.raw });
	return fields;
}

export function interpretMetar(text: string, continuation = false): AcarsInterpretation | undefined {
	const report = decodeMetar(text);
	if (!report) return;
	if (continuation) report.complete = false;
	return {
		title: 'Aerodrome weather report',
		summary: `${report.station} · core METAR observation.`,
		coverage: report.complete ? 'decoded' : 'partial',
		fields: metarFields(report),
		weather: [report],
		notes: [
			'METAR observation and supported remark groups use documented units. Remark periods remain separate from main-body measurements; original text and unsupported groups are retained. Application integrity is unverified.',
			...(report.unconsumed.length
				? [
						'Trend, malformed or unsupported groups remain in weather.unconsumed; original remarks remain in weather.remarks.raw.',
					]
				: []),
		],
	};
}
