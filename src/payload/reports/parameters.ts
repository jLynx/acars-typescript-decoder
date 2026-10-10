import type { AcarsInterpretation } from '@/payload/types';

/** Explicit Airbus PR identifier/value records; parameter names and units are unverified. */
export function interpretParameters(text: string, continuation: boolean): AcarsInterpretation | undefined {
	const records = [...text.matchAll(/(?:^|;)PR(\d{5}\.\d{5}\.\d{1,3}),([+-]?\d+(?:\.\d+)?)(?=;|$)/g)].filter(
		(match) => !continuation || match.index + match[0].length < text.length,
	);
	if (!records.length) return;
	const consumed = new Set(records.map((match) => match.index));
	const unconsumed = text
		.replace(/(?:^|;)PR\d{5}\.\d{5}\.\d{1,3},[+-]?\d+(?:\.\d+)?(?=;|$)/g, (match, offset: number) =>
			consumed.has(offset) ? '' : match,
		)
		.replace(/^;+|;+$/g, '');
	return {
		title: 'Aircraft parameter records',
		summary: `${records.length} PR identifier/value records · parameter names and units unverified.`,
		coverage: 'partial',
		coverageDetail: 'Explicit identifier/value records extracted · meanings and units unverified',
		fields: [
			{ label: 'Record format', value: 'PR' },
			...records.slice(0, 64).map((match) => ({ label: `PR ${match[1]} (raw)`, value: match[2] })),
		],
		notes: [
			'The PR prefix and comma delimit each parameter identifier and transmitted value. No equipment name, scale or unit is assigned without an aircraft dictionary.',
			...(unconsumed
				? [
						'Other content or a split record is retained in the original text; records are not reconstructed across missing blocks.',
					]
				: []),
			...(records.length > 64
				? ['Only the first 64 records are displayed; the complete original text is retained.']
				: []),
		],
	};
}

/** A configuration-only Airbus part does not carry a REP report identifier. */
export function interpretAirbusPart(text: string): AcarsInterpretation | undefined {
	const match = /^(A\d{3})(\d{6},\d+,\d+,TB\d+);(?=[+-]?\d)/.exec(text);
	if (!match) return;
	return {
		title: `${match[1]} aircraft report part`,
		summary: `${match[1]} configuration header · report identifier unavailable in this part.`,
		coverage: 'partial',
		coverageDetail: 'Configuration prefix identified · report and measurements undecoded',
		fields: [
			{ label: 'Aircraft type', value: match[1] },
			{ label: 'Configuration header (raw)', value: match[2] },
		],
		notes: [
			'This part contains an Airbus configuration prefix without a REP/H01/H02 report header. It is not assigned another message’s report ID, route or date. Numeric content and application part numbering remain unverified.',
		],
	};
}
