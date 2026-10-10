import { isDeepStrictEqual } from 'node:util';

const aliases = new Map([
	['Text Message', 'Application text'],
	['Message Sublabel', 'H1 sublabel'],
	['Tail', 'Reported registration'],
	['OHMA Downlink', 'Application JSON'],
]);

export function allFields(result, depth = 0) {
	return [...result.fields, ...(result.embedded && depth < 4 ? allFields(result.embedded, depth + 1) : [])];
}

const normalized = (value) => value.replace(/ UTC \(date not supplied\)$/, '');
function json(value) {
	try {
		return { value: JSON.parse(value) };
	} catch {
		return undefined;
	}
}

/** Classify every display mismatch with concrete evidence; unresolved fields remain visible. */
export function compareFields(expected, actual, input) {
	const have = allFields(actual);
	return expected.map((field) => {
		const same = have.find((item) => item.label === field.label && normalized(item.value) === normalized(field.value));
		if (same) return { ...field, classification: 'equal' };
		const ti2 = compareTi2(field, actual, input);
		if (ti2) return ti2;
		const alias = aliases.get(field.label);
		const renamed = have.find((item) => item.label === alias && normalized(item.value) === normalized(field.value));
		if (renamed) return { ...field, classification: 'renamed', actual: renamed };
		const parsed = json(field.value);
		const equivalent =
			parsed &&
			have.find((item) => {
				const candidate = json(item.value);
				return (
					(item.label === field.label || item.label === alias) &&
					candidate &&
					isDeepStrictEqual(parsed.value, candidate.value)
				);
			});
		if (equivalent) return { ...field, classification: 'json-equivalent', actual: equivalent };
		const flight = /^[A-Z]\d{2}[A-Z]([A-Z0-9]{2})(\d{4})/.exec(input.text);
		const reported = have.find((item) => item.label === 'Flight Number' && item.value === flight?.[1] + flight?.[2]);
		if (field.label === 'Flight Number' && flight && reported && field.value === flight[1] + Number(flight[2]))
			return { ...field, classification: 'preserved-wire-flight-code', actual: reported };
		const header = have.find((item) => item.label === 'Embedded label / sublabel / function');
		const address = have.find((item) => item.label === 'Aircraft identifier (raw)');
		if (field.label === 'Tail' && address?.value.replace(/^[. ]+/, '') === field.value)
			return { ...field, classification: 'retained-header', actual: address };
		const token = field.label === 'Message Label' ? 0 : field.label === 'Message Sublabel' ? 1 : undefined;
		if (token !== undefined && header?.value.split(' / ')[token] === field.value)
			return { ...field, classification: 'retained-header', actual: header };
		if (field.value === 'undefined') return { ...field, classification: 'invalid-upstream-value' };
		const refusal = actual.notes.find((note) =>
			/CRC failed|Incomplete ASCII85|Declared PDU length|incomplete|truncated|invalid|decoding failed/i.test(note),
		);
		if (refusal && input.text.includes('OHMA'))
			return { ...field, classification: 'integrity-refusal', reason: refusal };
		return { ...field, classification: 'unresolved' };
	});
}

/** Evidence for corrected TI2 semantics, rather than accepting upstream's conflated checksum. */
function compareTi2(field, actual, input) {
	if (actual.application?.variant !== 'AtisRequest') return;
	const values = actual.application.values;
	if (field.label === 'Destination' && field.value === values.airport)
		return { ...field, classification: 'renamed', actual: { airport: values.airport } };
	if (field.label === 'ATIS Code' && Number(field.value) === values.offset)
		return {
			...field,
			classification: 'corrected-byte-offset',
			actual: { offset: values.offset, currentAtis: values.currentAtis },
		};
	const suffix = values.currentAtis + actual.application.integrity.checksum;
	if (
		field.label === 'Message Checksum' &&
		field.value.toLowerCase() === `0x${suffix.toLowerCase()}` &&
		input.text.endsWith(suffix)
	)
		return { ...field, classification: 'corrected-ti2-checksum-boundary', actual: actual.application.integrity };
	const legacy = /^[A-Z](\d{2})[A-Z]([A-Z0-9]+)$/.exec(values.prefix ?? '');
	if (
		legacy &&
		((field.label === 'Flight Number' && field.value === legacy[2]) ||
			(field.label === 'Sequence Number' && Number(field.value) === Number(legacy[1])))
	)
		return { ...field, classification: 'retained-raw-prefix', actual: { prefix: values.prefix } };
}
