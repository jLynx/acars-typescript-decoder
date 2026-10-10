import type { AcarsInterpretation } from '@/payload/types';

/** Delimited H01/H02 Airbus header present in the pinned Airframes MIAM fixture. */
export function interpretAirbusH01(text: string): AcarsInterpretation | undefined {
	const header =
		/^(A\d{3}),([^/;]+)\/REP(\d+),([^;]+);H01,([^/]+)\/H02,([A-Z]{4}) ([A-Z]{4}),([A-Z0-9]+) *,([^/]*)/.exec(text);
	if (!header) return;
	const [, type, configuration, report, reportHeader, h01, departure, destination, flight, h02] = header;
	const registration = /(?:^|,)\.([A-Z0-9-]+)(?:,|$)/.exec(h01)?.[1];
	return {
		title: `${type} aircraft report ${report}`,
		summary: `${type} · ${departure} → ${destination} · report ${report}.`,
		coverage: 'partial',
		coverageDetail: 'Header decoded · measurements undecoded',
		fields: [
			{ label: 'Aircraft type', value: type },
			{ label: 'Report ID', value: report },
			{ label: 'Departure', value: departure },
			{ label: 'Destination', value: destination },
			{ label: 'Reported flight code', value: flight },
			...(registration ? [{ label: 'Reported registration', value: registration }] : []),
			{ label: 'Configuration header (raw)', value: configuration },
			{ label: 'Report header (raw)', value: reportHeader },
			{ label: 'H01 header (raw)', value: h01 },
			{ label: 'H02 values (raw)', value: h02 },
		],
		notes: [
			'The H01/H02 identifiers are decoded. Numeric report sections and date/time codes remain raw; their units, scales and timezone require the aircraft report specification.',
		],
	};
}
