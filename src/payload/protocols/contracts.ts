// ADS-C contract layouts adapted from xoolive/datalink and checked against libacars.
import type { Bits } from './bits';
import type { AcarsField } from '@/payload/types';
import type { AdscContractDecode } from './types';

const groupNames: Record<number, string> = {
	12: 'Flight identification',
	13: 'Predicted route',
	14: 'Ground track / speed',
	15: 'Heading / Mach',
	16: 'Weather',
	17: 'Airframe identification',
	21: 'Aircraft intent',
};

export function contractFields(bits: Bits, tag: number): AcarsField[] | undefined {
	return decodeContract(bits, tag)?.fields;
}

export function decodeContract(bits: Bits, tag: number): AdscContractDecode | undefined {
	if (tag === 1) return { fields: [{ label: 'Contract control', value: 'Cancel all contracts' }], notes: [] };
	if (tag === 2 || tag === 6) return { fields: [{ label: 'Cancel contract', value: String(bits.read(8)) }], notes: [] };
	if (![7, 8, 9].includes(tag)) return;
	const fields = [
		{
			label: tag === 8 ? 'Event contract' : tag === 9 ? 'Emergency periodic contract' : 'Periodic contract',
			value: String(bits.read(8)),
		},
	];
	const groups = new Set<number>(),
		notes: string[] = [];
	while (bits.remaining >= 8) {
		const position = bits.position;
		const group = bits.read(8);
		// libacars parses the same request-group catalogue in each contract type.
		// An interval may be absent or appear after another group; wire order is retained.
		const field = requestField(bits, group);
		if (!field) {
			bits.position = position;
			break;
		}
		fields.push(field);
		if (groups.has(group)) notes.push(`Duplicate ADS-C request group ${group}; declarations retained.`);
		groups.add(group);
		const validType = tag === 8 ? [10, 18, 19, 20].includes(group) : group === 11 || Boolean(groupNames[group]);
		if (!validType) notes.push(`ADS-C group ${group} is not valid for this contract type; fields retained.`);
	}
	if (tag !== 8 && !groups.has(11))
		notes.push(
			'Periodic contract has no reporting interval; fields are retained but contract semantics are unverified.',
		);
	if (tag === 8 && !groups.size) notes.push('Event contract has no event triggers; contract semantics are unverified.');
	return { fields, notes };
}

function requestField(bits: Bits, group: number): AcarsField | undefined {
	if (group === 11) {
		const code = bits.read(8);
		return { label: 'Reporting interval', value: `${[0, 1, 8, 64][code >> 6] * ((code & 63) + 1)} seconds` };
	}
	return eventField(bits, group) ?? groupField(bits, group);
}

function groupField(bits: Bits, group: number): AcarsField | undefined {
	if (!groupNames[group]) return;
	const modulus = bits.read(8);
	return {
		label: `Requested ${groupNames[group]}`,
		value: `Reporting modulus ${modulus}${group === 21 ? ` · projection ${bits.read(8)} minutes` : ''}`,
	};
}

function eventField(bits: Bits, tag: number): AcarsField | undefined {
	if (tag === 10) return { label: 'Lateral deviation threshold', value: `${bits.read(8) / 8} NM` };
	if (tag === 18) {
		const threshold = bits.signed(8) * 64;
		return { label: 'Vertical speed threshold', value: `${threshold < 0 ? '<' : '>'} ${Math.abs(threshold)} ft/min` };
	}
	if (tag === 19)
		return { label: 'Altitude range', value: `Ceiling ${bits.signed(16) * 4} ft · floor ${bits.signed(16) * 4} ft` };
	if (tag === 20) return { label: 'Event trigger', value: 'Waypoint change' };
}
