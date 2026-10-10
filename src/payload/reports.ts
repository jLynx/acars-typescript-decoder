import type { AcarsRecord } from '@/types';
import type { AcarsField, AcarsInterpretation } from './types';
import { timeFields } from './time';

import { airportDescription as airport } from '@/payload/reference/codes';
import { boeingHeaderFields, interpretApu } from '@/payload/reports/boeing';
import { interpretParameters, interpretAirbusPart } from '@/payload/reports/parameters';

const routeFields = (departure: string, destination: string): AcarsField[] => [
	{ label: 'Departure', value: airport(departure) },
	{ label: 'Destination', value: airport(destination) },
];

export function interpretPosition(message: AcarsRecord): AcarsInterpretation | undefined {
	// Match the explicit hemisphere/decimal-degree/UTC layout, not every label-3L payload.
	const match =
		/^([NS])[ \t]*(\d{1,2}(?:\.\d+)?)[ \t]*\/[ \t]*([EW])[ \t]*(\d{1,3}(?:\.\d+)?)[ \t]*\/[ \t]*UTC[ \t]+(\d{4})$/.exec(
			message.text.trim(),
		);
	if (!match || message.direction !== 'downlink') return;
	const [, northSouth, latitude, eastWest, longitude, clock] = match;
	if (Number(latitude) > 90 || Number(longitude) > 180) return;
	const time = timeFields(clock, message.receivedAt, 'HHMM');
	if (!time.length) return;
	return {
		title: 'Position report',
		summary: `Reported position · ${latitude}° ${northSouth}, ${longitude}° ${eastWest} · ${clock.slice(0, 2)}:${clock.slice(2)} UTC.`,
		coverage: 'decoded',
		fields: [
			{ label: 'Latitude', value: `${latitude}° ${northSouth} (${northSouth === 'S' ? '-' : ''}${latitude}°)` },
			{ label: 'Longitude', value: `${longitude}° ${eastWest} (${eastWest === 'W' ? '-' : ''}${longitude}°)` },
			...time,
		],
		notes: [
			'Coordinates are decimal degrees. The event date is inferred from reception; the payload supplies UTC hour and minute only.',
		],
	};
}

export function interpretTakeoff(message: AcarsRecord): AcarsInterpretation | undefined {
	// Label 10 varies by airline. Recognize this OFF layout rather than assigning meanings to all label 10 messages.
	const match = /^OFF(\d{6}),([A-Z]{4}),([A-Z]{4}),([^,\r\n]*),([^,\r\n]*),LT,([^,\r\n]*),([^,\r\n]*)$/.exec(
		message.text.trim(),
	);
	if (!match || message.direction !== 'downlink') return;
	const [, clock, departure, destination] = match;
	const time = timeFields(clock, message.receivedAt, 'DDHHMM');
	if (!time.length) return;
	return {
		title: 'Wheels-off report',
		summary: `Takeoff reported · ${airport(departure)} → ${airport(destination)}.`,
		coverage: 'partial',
		fields: [{ label: 'Event', value: 'OFF · wheels off / airborne' }, ...routeFields(departure, destination), ...time],
		notes: [
			'The event date is inferred from reception. Additional airline-specific fields are retained in the raw message.',
		],
	};
}

/** Recognizes explicit POS markers; compact coordinate scales and extra columns remain unverified. */
export function interpretPos(message: AcarsRecord): AcarsInterpretation | undefined {
	const match =
		/^POS(\d{6}),[ \t]*([NS])[ \t]*(\d{2,4}(?:\.\d+)?),[ \t]*([EW])[ \t]*(\d{3,5}(?:\.\d+)?),([^\r\n]+)$/.exec(
			message.text.trim(),
		);
	if (!match || message.direction !== 'downlink') return;
	const [, clock, northSouth, latitude, eastWest, longitude, extra] = match;
	return {
		title: 'Position report',
		summary: `POS report · ${northSouth} ${latitude}, ${eastWest} ${longitude} (raw coordinates).`,
		coverage: 'partial',
		coverageDetail: 'Position markers identified · coordinate scale and additional fields unverified',
		fields: [
			{ label: 'Report code', value: 'POS' },
			{ label: 'Header time code (raw)', value: clock },
			{ label: 'Latitude (raw)', value: `${northSouth} ${latitude}` },
			{ label: 'Longitude (raw)', value: `${eastWest} ${longitude}` },
			{ label: 'Additional fields (raw)', value: extra },
		],
		notes: [
			'The POS marker and hemisphere fields identify a position report. Compact coordinate scale, time-code semantics and remaining numeric columns are not verified; no degrees, altitude, fuel units or event date are assigned.',
		],
	};
}

/** Extracts visible identifiers from an observed APM header without decoding its numeric body. */
export function interpretApm(text: string): AcarsInterpretation | undefined {
	const match =
		/^APM[ \t]+(\d+)[ \t]+([A-Z0-9-]+)[ \t]+([A-Z]{3}\d+[A-Z]?)[ \t]+([A-Z]{4})([A-Z]{4})(\d{6})(\d{6}),(?:\r?\n|$)/.exec(
			text,
		);
	if (!match) return;
	const [, report, registration, flight, departure, destination, date, clock] = match;
	return {
		title: 'Aircraft report APM',
		summary: `APM · ${registration} · ${flight} · ${airport(departure)} → ${airport(destination)}.`,
		coverage: 'partial',
		coverageDetail: 'Header identified · measurements undecoded',
		fields: [
			{ label: 'Report code', value: 'APM' },
			{ label: 'Report number (raw)', value: report },
			{ label: 'Reported registration', value: registration },
			{ label: 'Reported flight code', value: flight },
			...routeFields(departure, destination),
			{ label: 'Header date code (raw)', value: date },
			{ label: 'Header time code (raw)', value: clock },
		],
		notes: [
			'The observed APM header supplies aircraft, flight and route identifiers. The report number, date/time encoding, timezone and numeric measurements require the aircraft report specification; their meanings, scales and units are not assigned.',
		],
	};
}

export function interpretMonitoring(message: AcarsRecord): AcarsInterpretation | undefined {
	const match = /^01([A-Z]{4}) +([A-Z0-9]+)\/(\d{6})([A-Z]{4})([A-Z]{4})(?:\r?\n|$)/.exec(message.text.trim());
	if (!match || message.direction !== 'downlink') return;
	const [, code, flight, clock, departure, destination] = match;
	return {
		title: `Airline report ${code}`,
		summary: `${code} · ${flight} · ${airport(departure)} → ${airport(destination)}.`,
		coverage: 'partial',
		fields: [
			{ label: 'Report code', value: code },
			{ label: 'Reported flight', value: flight },
			...routeFields(departure, destination),
			{ label: 'Reported time code', value: clock },
			...timeFields(clock, message.receivedAt, 'DDHHMM'),
		],
		notes: [
			'The report code and numeric measurements use an airline-specific format; their meanings and units are not decoded.',
			'If shown, the event date is inferred from reception using a day/hour/minute time code.',
		],
	};
}

export function interpretDf(text: string, continuation = false): AcarsInterpretation {
	// Some reports have a routing address before the report identifier.
	text = text.replace(/^\/[A-Z0-9]{7}\./, '');
	const header = /^<(\d+)>([A-Z0-9]+)/.exec(text);
	if (!header) {
		const explicit = interpretApu(text) ?? interpretAirbusPart(text) ?? interpretParameters(text, continuation);
		if (explicit) return explicit;
	}
	const identifiers = boeingHeaderFields(text, continuation);
	const route = header ? /([A-Z]{4})([A-Z]{4})(?=\d+\s*$| \d{3}[A-Z]{2}\d{12})/m.exec(text) : null;
	const sections = [...text.matchAll(/(?:^|;)A(\d{2})(?=[+-])/g)].map((match) => `A${match[1]}`);
	return {
		title: header ? `Aircraft report ${header[2]}` : 'Aircraft report fragment',
		summary: header
			? `DF report · ${header[2]} · report ID ${header[1]}.`
			: 'DF report fragment · numeric data retained as received.',
		coverage: header ? 'partial' : 'unknown',
		coverageDetail: header ? 'Header decoded · measurements undecoded' : 'Payload undecoded',
		fields: [
			...(header
				? [
						{ label: 'Report ID', value: header[1] },
						{ label: 'Report code', value: header[2] },
					]
				: []),
			...(identifiers.length ? identifiers : route ? routeFields(route[1], route[2]) : []),
			...(sections.length
				? [{ label: 'Numeric section identifiers (raw)', value: [...new Set(sections)].join(', ') }]
				: []),
		],
		notes: [
			'This DF payload is not decoded by the Airframes library or a supported report parser. Numeric sections need the aircraft report specification to assign meanings and units.',
			...(identifiers.length
				? [
						'The observed report header supplies aircraft, flight and route identifiers. Header date/time codes, timezone and other numeric fields remain unverified and are retained as raw values.',
					]
				: []),
			...(header ? [] : ['This block has no recognized report header. Continued blocks are displayed separately.']),
		],
	};
}
