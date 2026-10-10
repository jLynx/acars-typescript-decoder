// Narrow label-16/32/37 layouts adapted from MIT datalink aoc readers.
import type { AcarsRecord } from '@/types';
import type { AcarsField, AcarsInterpretation } from '@/payload/types';
import { interpretCommunity } from '@/payload/community';

export function interpretTelemetry(message: AcarsRecord): AcarsInterpretation | undefined {
	if (message.direction !== 'downlink') return;
	const columns = message.text
		.trim()
		.split(',')
		.map((column) => column.trim());
	if (message.label === '32') return label32(message.text, columns);
	if (message.label === '16' && columns.length >= 3 && /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(columns[0])) {
		const result = interpretCommunity(message) ?? report('Airline telemetry', []);
		result.fields.push(
			{ label: 'Time code (raw)', value: columns[0] },
			{ label: 'Field count', value: String(columns.length) },
			{ label: 'Telemetry columns (raw)', value: JSON.stringify(columns) },
		);
		return result;
	}
	if (message.label === '37') {
		const lines = message.text
			.trim()
			.split(/\r?\n/)
			.filter((line) => line.trim());
		if (lines.length >= 2 && /^[A-Z0-9]{4}-[A-Z0-9]+$/.test(lines[0]))
			return report('Encoded airline operations message', [
				{ label: 'Prefix (raw)', value: lines[0] },
				{ label: 'Line count', value: String(lines.length) },
			]);
	}
}

function label32(text: string, columns: string[]): AcarsInterpretation | undefined {
	// Upstream's generic CSV search can assign arbitrary following values to altitude.
	// Require the observed P,R timestamp layout before assigning the documented fields.
	if (columns.length < 8 || columns[0] !== 'P' || columns[1] !== 'R') return;
	const clock = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(columns[2]);
	const point = /^([NS])(\d{1,2}\.\d+) ([EW])(\d{1,3}\.\d+)$/.exec(columns[5]);
	if (!clock || !point || !/^-?\d+$/.test(columns[6]) || !/^\d+$/.test(columns[7])) return;
	const latitude = Number(point[2]) * (point[1] === 'S' ? -1 : 1);
	const longitude = Number(point[4]) * (point[3] === 'W' ? -1 : 1);
	const heading = Number(columns[7]);
	const altitude = Number(columns[6]);
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || heading > 360 || Math.abs(altitude) > 150000) return;
	const date = new Date(columns[2].replace(' ', 'T') + 'Z');
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19).replace('T', ' ') !== columns[2]) return;
	return report('Airline position telemetry', [
		{ label: 'Reported date/time', value: `${columns[2]} · timezone unspecified` },
		{ label: 'Latitude', value: `${latitude}°` },
		{ label: 'Longitude', value: `${longitude}°` },
		{ label: 'Altitude', value: `${altitude} ft` },
		{ label: 'Heading', value: `${heading}° · reference unspecified` },
		{ label: 'Telemetry columns (raw)', value: JSON.stringify(columns) },
		{ label: 'Telemetry text (raw)', value: text },
	]);
}

function report(title: string, fields: AcarsField[]): AcarsInterpretation {
	return {
		title,
		summary: `${title}${fields.length ? ` · ${fields[0].value}` : ''}`,
		coverage: 'partial',
		fields,
		notes: [
			'Layout adapted from MIT datalink. Remaining columns or encoded content require their airline specification. Original text is retained.',
		],
	};
}
