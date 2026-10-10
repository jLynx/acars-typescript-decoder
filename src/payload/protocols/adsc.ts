// ADS-C tag layouts/scales: MIT libacars and xoolive/datalink (see public/licenses/acars.txt).
import { Bits } from './bits';
import { decodeContract } from './contracts';
import type { AcarsField } from '@/payload/types';
import type { ApplicationDecode } from './types';
import { negativeAcknowledgement } from './adsc/control';

const basicNames: Record<number, string> = {
	7: 'Position report',
	9: 'Emergency position report',
	10: 'Lateral deviation event',
	18: 'Vertical rate event',
	19: 'Altitude range event',
	20: 'Waypoint change event',
};
const angle = (value: number, scale: number) => (value * scale + 360) % 360;
const number = (value: number) => String(Number(value.toFixed(6)));
const accuracy = [
	'Navigation capability lost',
	'< 30 NM',
	'< 15 NM',
	'< 8 NM',
	'< 4 NM',
	'< 1 NM',
	'< 0.25 NM',
	'< 0.05 NM',
];

function unsupported(value: number, label: string, notes: string[]): AcarsField[] {
	if (!value) return [];
	notes.push(`${label} contains unassigned bits; their raw value is retained without assigning semantics.`);
	return [{ label: `${label} (raw)`, value: String(value) }];
}

function coordinates(bits: Bits, prefix = ''): AcarsField[] {
	const latitude = (bits.signed(21) * 180) / 2 ** 20;
	const longitude = (bits.signed(21) * 180) / 2 ** 20;
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid position');
	return [
		{ label: `${prefix}Latitude`, value: `${number(latitude)}°` },
		{ label: `${prefix}Longitude`, value: `${number(longitude)}°` },
		{ label: `${prefix}Altitude`, value: `${bits.signed(16) * 4} ft` },
	];
}

function basic(bits: Bits, tag: number, notes: string[]): AcarsField[] {
	const fields = [{ label: 'ADS-C report', value: basicNames[tag] }, ...coordinates(bits)];
	const time = bits.read(15) / 8;
	const status = bits.read(7);
	fields.push(
		{ label: 'Report time', value: `${time} seconds past the hour (date/hour not supplied)` },
		{ label: 'Navigation redundancy', value: status & 1 ? 'Available' : 'Unavailable' },
		{ label: 'Position accuracy code', value: String((status >> 1) & 7) },
		{ label: 'Position accuracy', value: accuracy[(status >> 1) & 7] },
		{ label: 'TCAS', value: status & 16 ? 'Available' : 'Unavailable' },
		...unsupported(status >> 5, 'Basic report status remainder', notes),
	);
	return fields;
}

function velocity(bits: Bits, tag: number, notes: string[]): AcarsField[] {
	const invalid = bits.read(1);
	const heading = angle(bits.signed(12), 180 / 2048);
	const speed = bits.read(13);
	const vertical = bits.signed(12) * 16;
	const remainder = bits.read(2);
	return [
		{ label: tag === 14 ? 'True track' : 'True heading', value: invalid ? 'Unavailable' : `${number(heading)}°` },
		{ label: tag === 14 ? 'Ground speed' : 'Mach', value: tag === 14 ? `${speed / 2} kt` : String(speed / 2000) },
		{ label: tag === 14 ? 'Ground vertical rate' : 'Air vertical rate', value: `${vertical} ft/min` },
		...unsupported(remainder, `${tag === 14 ? 'Earth' : 'Air'} reference remainder`, notes),
	];
}

function weather(bits: Bits, notes: string[]): AcarsField[] {
	const speed = bits.read(9) / 2;
	const invalid = bits.read(1);
	const direction = angle(bits.signed(9), 180 / 256);
	const temperature = bits.signed(12) / 4;
	const remainder = bits.read(1);
	return [
		{ label: 'Wind speed', value: `${speed} kt` },
		{ label: 'True wind direction', value: invalid ? 'Unavailable' : `${number(direction)}°` },
		{ label: 'Temperature', value: `${temperature} °C` },
		...unsupported(remainder, 'Meteorological report remainder', notes),
	];
}

function projection(bits: Bits, tag: number, notes: string[]): AcarsField[] {
	if (tag === 13) {
		const fields = [
			...coordinates(bits, 'Next waypoint '),
			{ label: 'Next waypoint ETA', value: `${bits.read(14)} seconds` },
			...coordinates(bits, 'Following waypoint '),
		];
		fields.push(...unsupported(bits.read(6), 'Predicted route remainder', notes));
		return fields;
	}
	if (tag === 23)
		return [...coordinates(bits, 'Projected '), { label: 'Projection time', value: `${bits.read(14)} seconds` }];
	const distance = bits.read(16) / 8;
	const invalid = bits.read(1);
	const track = angle(bits.signed(12), 180 / 2048);
	const altitude = bits.signed(16) * 4;
	const eta = bits.read(14);
	const remainder = bits.read(5);
	return [
		{ label: 'Projected distance', value: `${distance} NM` },
		{ label: 'Projected track', value: invalid ? 'Unavailable' : `${number(track)}°` },
		{ label: 'Projected altitude', value: `${altitude} ft` },
		{ label: 'Projection time', value: `${eta} seconds` },
		...unsupported(remainder, 'Intermediate projection remainder', notes),
	];
}

function noncompliance(bits: Bits, notes: string[]): AcarsField[] {
	const contract = bits.read(8);
	const count = bits.read(8);
	const fields = [
		{ label: 'Noncompliance contract', value: String(contract) },
		{ label: 'Noncompliant group count', value: String(count) },
	];
	for (let group = 0; group < count; group++) {
		const tag = bits.read(8);
		const unrecognized = bits.read(1);
		const unavailable = bits.read(1);
		fields.push(...unsupported(bits.read(2), `Noncompliant group ${tag} flag remainder`, notes));
		const size = bits.read(4);
		const parameters: number[] = [];
		if (!unrecognized && !unavailable) {
			for (let i = 0; i < size; i++) parameters.push(bits.read(4));
			if (size % 2) fields.push(...unsupported(bits.read(4), `Noncompliant group ${tag} parameter padding`, notes));
		}
		if (unrecognized || unavailable)
			fields.push({
				label: `Noncompliant group ${tag} flags/count (raw)`,
				value: `${unrecognized}${unavailable}/${size}`,
			});
		fields.push({
			label: `Noncompliant group ${tag}`,
			value: unrecognized ? 'Unrecognized' : unavailable ? 'Unavailable' : `Parameter codes: ${parameters.join(', ')}`,
		});
	}
	return fields;
}

function downlinkFields(bits: Bits, tag: number, notes: string[]): AcarsField[] | undefined {
	if (basicNames[tag]) return basic(bits, tag, notes);
	if (tag === 14 || tag === 15) return velocity(bits, tag, notes);
	if (tag === 16) return weather(bits, notes);
	if ([13, 22, 23].includes(tag)) return projection(bits, tag, notes);
	if (tag === 5) return noncompliance(bits, notes);
	if (tag === 6) return [{ label: 'Emergency mode', value: 'Cancelled' }];
	if (tag === 3) return [{ label: 'Acknowledged contract', value: String(bits.read(8)) }];
	if (tag === 4) return negativeAcknowledgement(bits);
	if (tag === 17)
		return [{ label: 'ICAO aircraft address', value: bits.read(24).toString(16).padStart(6, '0').toUpperCase() }];
	if (tag === 12) {
		let flight = '';
		for (let i = 0; i < 8; i++) {
			const code = bits.read(6);
			if (!(code >= 1 && code <= 26) && code !== 32 && !(code >= 48 && code <= 57))
				throw new Error('Invalid ADS-C flight identification character');
			flight += String.fromCharCode(code & 32 ? code : code + 64);
		}
		return [{ label: 'Reported flight', value: flight.trimEnd() }];
	}
}

export function decodeAdsc(bytes: Uint8Array, direction: 'uplink' | 'downlink'): ApplicationDecode {
	if (!(bytes instanceof Uint8Array) || bytes.length > 8192 || !['uplink', 'downlink'].includes(direction))
		throw new TypeError('Invalid ADS-C input/direction');
	const bits = new Bits(bytes);
	const fields: AcarsField[] = [];
	const notes: string[] = [];
	let unknown: number | undefined;
	while (bits.remaining) {
		const tag = bits.read(8);
		const contract = direction === 'uplink' ? decodeContract(bits, tag) : undefined;
		const next = direction === 'uplink' ? contract?.fields : downlinkFields(bits, tag, notes);
		if (!next) {
			unknown = tag;
			break;
		}
		fields.push(...next);
		if (contract) notes.push(...contract.notes);
		if (fields.length > 200) throw new Error('Too many application fields');
	}
	if (!fields.length) throw new Error('No supported ADS-C tags');
	const position = fields.find((field) => field.label === 'Latitude');
	return {
		fields,
		complete: unknown === undefined && !notes.length,
		summary: position
			? `ADS-C position · ${position.value}, ${fields.find((field) => field.label === 'Longitude')?.value} · ${fields.find((field) => field.label === 'Altitude')?.value}.`
			: `ADS-C ${direction === 'uplink' ? 'contract request' : 'report'} · ${fields[0].value}.`,
		notes: [
			...notes,
			...(unknown === undefined
				? []
				: [
						`Unsupported ADS-C tag ${unknown}; the remaining application bytes are preserved without guessing their layout.`,
					]),
		],
	};
}
