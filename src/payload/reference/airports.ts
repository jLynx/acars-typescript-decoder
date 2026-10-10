import type { AcarsInterpretation } from '@/payload/types';

/** Enrich only explicitly identified airport fields, preserving all raw radio text. */
export function describeAirports(
	result: AcarsInterpretation,
	lookup?: (code: string) => string | undefined,
): AcarsInterpretation {
	if (!lookup) return result;
	const replacements = new Map<string, string>();
	result.fields = result.fields.map((field) => {
		if (
			!/^(?:Departure|Destination|Alternate Destination|Origin|Airport|Airport code|ATIS Airport|Requested airport \(ICAO\))$/.test(
				field.label,
			)
		)
			return field;
		if (!/^[A-Z]{3,4}$/.test(field.value)) return field;
		const name = lookup(field.value);
		const value = name ? `${field.value} · ${name}` : field.value;
		if (value !== field.value) replacements.set(field.value, value);
		return { ...field, value };
	});
	if (replacements.size) {
		const pattern = new RegExp(`\\b(?:${[...replacements.keys()].join('|')})\\b`, 'g');
		result.summary = result.summary.replace(pattern, (code) => replacements.get(code)!);
	}
	return result;
}
