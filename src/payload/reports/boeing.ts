import type { AcarsField, AcarsInterpretation } from '@/payload/types';
import { airportDescription } from '@/payload/reference/codes';

// Independently read visible identifiers in observed October 2026 header layouts.
// These readers do not interpret aircraft-specific numeric measurements.
const routeFields = (departure: string, destination: string): AcarsField[] => [
	{ label: 'Departure', value: airportDescription(departure) },
	{ label: 'Destination', value: airportDescription(destination) },
];
const identifiers = (registration: string, flight: string): AcarsField[] => [
	{ label: 'Reported registration', value: registration },
	{ label: 'Reported flight code', value: flight },
];

function terminated(match: RegExpExecArray | null, continuation: boolean): match is RegExpExecArray {
	return Boolean(match && (!continuation || match[0].endsWith('\n')));
}

export function boeingHeaderFields(text: string, continuation: boolean): AcarsField[] {
	const aer =
		/^<\d+>AER9[ \t]+\d+\r?\n[ \t]*([A-Z0-9]+-[A-Z0-9]+)([A-Z]{3}\d+[A-Z]?)[ \t]+(\d{6})(\d{6})([A-Z]{4})([A-Z]{4})(?:\r?\n|$)/.exec(
			text,
		);
	if (terminated(aer, continuation))
		return [
			...identifiers(aer[1], aer[2]),
			...routeFields(aer[5], aer[6]),
			{ label: 'Header date code (raw)', value: aer[3] },
			{ label: 'Header time code (raw)', value: aer[4] },
		];
	const heg =
		/^<\d+>HEG9[ \t]+\d+\r?\n[ \t]*([A-Z0-9]+-[A-Z0-9]+)([A-Z]{3}\d+[A-Z]?)[ \t]+([A-Z]{4})([A-Z]{4})[ \t]+(\d{3}[A-Z]{2})(\d{6})(\d{6})[ \t]+\d+(?:\r?\n|$)/.exec(
			text,
		);
	if (terminated(heg, continuation))
		return [
			...identifiers(heg[1], heg[2]),
			...routeFields(heg[3], heg[4]),
			{ label: 'Header code (raw)', value: heg[5] },
			{ label: 'Header date code (raw)', value: heg[6] },
			{ label: 'Header time code (raw)', value: heg[7] },
		];
	const ker =
		/^<\d+>(KER|KER9)[ \t]*\r?\n[ \t]*([A-Z0-9]+-[A-Z0-9]+)([A-Z]{3}\d+[A-Z]?)[ \t]+(ER|TO)[ \t]+(\d{3})(\d{6})(\d{6})([A-Z]{4})([A-Z]{4})(\d+)[ \t]+(C[ \t]+\d+|\d+)(?:\r?\n|$)/.exec(
			text,
		);
	if (!terminated(ker, continuation)) return [];
	return [
		...identifiers(ker[2], ker[3]),
		...routeFields(ker[8], ker[9]),
		{ label: 'Header phase code (raw)', value: ker[4] },
		{ label: 'Header code (raw)', value: ker[5] },
		{ label: 'Header date code (raw)', value: ker[6] },
		{ label: 'Header time code (raw)', value: ker[7] },
		{ label: 'Route suffix (raw)', value: ker[10] },
		ker[11].startsWith('C')
			? { label: 'C value (raw)', value: ker[11].slice(1).trim() }
			: { label: 'Header suffix (raw)', value: ker[11] },
	];
}

export function interpretApu(text: string): AcarsInterpretation | undefined {
	const match = /^APU1\r?\n([A-Z]{4})\/([A-Z]{4})\/\r?\n/.exec(text);
	if (!match) return;
	return {
		title: 'Aircraft report APU1',
		summary: `APU1 · ${match[1]} → ${match[2]} · numeric data retained as received.`,
		coverage: 'partial',
		coverageDetail: 'Report code and route identified · measurements undecoded',
		fields: [{ label: 'Report code', value: 'APU1' }, ...routeFields(match[1], match[2])],
		notes: [
			'The APU1 marker and delimited route are recognized. Numeric columns, scales and units require the aircraft report specification.',
		],
	};
}

export function interpretTof(text: string, sublabel?: string): AcarsInterpretation | undefined {
	if (sublabel !== 'T5') return;
	const match =
		/^\/([A-Z0-9]{7})\.TOF(\d{3})([A-Z]{2})[ \t]+([A-Z0-9]+-[A-Z0-9]+?)(\d)([A-Z]{3}\d+[A-Z]?)[ \t]+(\d{6})(\d{6})([A-Z]{4})([A-Z]{4})(?=[+-])/.exec(
			text,
		);
	if (!match) return;
	return {
		title: 'Aircraft report TOF',
		summary: `TOF${match[2]} · ${match[4]} · ${match[6]} · ${match[9]} → ${match[10]}.`,
		coverage: 'partial',
		coverageDetail: 'Header identified · application body undecoded',
		fields: [
			{ label: 'Report code', value: 'TOF' },
			{ label: 'Routing address', value: match[1] },
			{ label: 'Report number (raw)', value: match[2] },
			{ label: 'Header airline code (raw)', value: match[3] },
			...identifiers(match[4], match[6]),
			...routeFields(match[9], match[10]),
			{ label: 'Header separator (raw)', value: match[5] },
			{ label: 'Header date code (raw)', value: match[7] },
			{ label: 'Header time code (raw)', value: match[8] },
		],
		notes: [
			'Visible T5/TOF header identifiers are extracted from this observed layout. Date/time codes, timezone, encoded body and measurement units are unverified; the full original text is retained.',
		],
	};
}
