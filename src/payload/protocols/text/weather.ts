// AOC SA weather bundle boundaries adapted from MIT datalink aoc/weather.rs.
import type { AcarsRecord } from '@/types';
import type { AcarsInterpretation } from '@/payload/types';

export function interpretWeather(message: AcarsRecord): AcarsInterpretation | undefined {
	if (!['RA', 'C1'].includes(message.label)) return;
	const header = /(?:^|\r?\n)[^\r\n]*?\bSA (0[1-9]|[12]\d|3[01])\/((?:[01]\d|2[0-3]):[0-5]\d)(?:[ \t]+|\r?\n)/g;
	const boundaries = [...message.text.matchAll(header)];
	if (!boundaries.length) return;
	const fields = boundaries.flatMap((match, index) => {
		const text = message.text.slice(match.index + match[0].length, boundaries[index + 1]?.index).trim();
		const station = /^([A-Z]{4})\s/.exec(text)?.[1];
		return station
			? [
					{ label: `Weather station ${index + 1}`, value: station },
					{ label: `Weather header ${index + 1}`, value: `Day ${match[1]} · ${match[2]} · date/timezone unspecified` },
					{ label: `Weather text ${index + 1}`, value: text },
				]
			: [];
	});
	if (fields.length !== boundaries.length * 3) return;
	return {
		title: 'Weather report bundle',
		summary: `${boundaries.length} weather reports · ${fields[0].value}`,
		coverage: 'partial',
		fields,
		notes: ['SA report boundaries and station identifiers decoded. METAR weather tokens remain transmitted text.'],
	};
}

export function interpretSlashFields(message: AcarsRecord): AcarsInterpretation | undefined {
	if (message.label !== '5Z' || !message.text.startsWith('/')) return;
	const [first, ...remarks] = message.text.split(/\r?\n/);
	const chunks = first.slice(1).split('/');
	const matches = chunks.map((chunk) => /^([A-Z]{2,3})[ \t]+([^]*)$/.exec(chunk));
	if (!matches.length || matches.some((match) => !match)) return;
	const fields = matches.map((match) => ({ label: `${match![1]} (raw)`, value: match![2].trim() }));
	if (remarks.length) fields.push({ label: 'Remarks', value: remarks.join('\n') });
	return {
		title: 'Airline slash-field message',
		summary: `${chunks.length} slash fields`,
		coverage: 'partial',
		fields,
		notes: [
			'Field names and values are retained from the datalink label-5Z layout; proprietary key meanings are unverified.',
		],
	};
}
