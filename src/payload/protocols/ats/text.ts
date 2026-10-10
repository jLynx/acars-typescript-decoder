// Text layout adapters from MIT xoolive/datalink, pinned in docs/upstreams.json.
import type { AcarsRecord } from '@/types';
import type { AcarsInterpretation, AcarsField } from '@/payload/types';
import type { AtsResult } from './types';

const source = (file: string) => ({
	repository: 'https://github.com/xoolive/datalink',
	revision: 'd3e3e5a5d2bda04fbee83832cb77e3050a87364c',
	files: [`crates/acars/src/decode/payload/${file}.rs`],
});

function result(application: AtsResult, title: string, fields: AcarsField[]): AcarsInterpretation {
	return {
		title,
		summary: `${title} · ${fields
			.slice(0, 3)
			.map((field) => field.value)
			.join(' · ')}`,
		coverage: 'partial',
		coverageDetail: 'Text fields decoded · application checksum unverified',
		fields,
		notes: [
			'Layout adapted from MIT xoolive/datalink. The transmitted application checksum is unverified; unsupported fields and original text are retained.',
		],
		application,
	};
}

export function interpretAfn(message: AcarsRecord): AcarsInterpretation | undefined {
	const match =
		/^(?:[A-Z0-9]{3,12})?\/([A-Z0-9]{4,7})\.AFN\/([A-Z]{3})([A-Z0-9]*),([. A-Z0-9-]*),([A-F0-9]{6}|),(\d{6})(\/[^]*)?([A-F0-9]{4})$/.exec(
			message.text.trim(),
		);
	if (!match) return;
	const [, facility, type, flight, registration, icao, clock, remainder = '', checksum] = match;
	const values: AtsResult['values'] = {
		facility,
		messageType: type,
		flight,
		registration: registration.replace(/^\./, '').trim(),
		timeCode: clock,
	};
	if (icao) values.icao24 = icao;
	const fields: AcarsField[] = [
		{ label: 'Ground address', value: facility },
		{ label: 'AFN message type', value: type },
		...(flight ? [{ label: 'Reported flight', value: flight }] : []),
		{ label: 'Reported registration', value: String(values.registration) },
		...(icao ? [{ label: 'ICAO aircraft address', value: icao }] : []),
		{ label: 'Header time code (raw)', value: clock },
	];
	const unconsumed: string[] = [];
	const applications: string[] = [];
	for (const part of remainder.split('/').filter(Boolean)) {
		const position = /^FPO([NS]\d+[EW]\d+),([^,]+)$/.exec(part);
		const app = /^(FAR|FCO)([A-Z]{3}),(.+)$/.exec(part);
		if (position) {
			values.position = position[1];
			values.positionSequence = position[2];
			fields.push(
				{ label: 'AFN position (raw)', value: position[1] },
				{ label: 'Position sequence (raw)', value: position[2] },
			);
		} else if (app) {
			applications.push(`${app[1]} ${app[2]} ${app[3]}`);
			fields.push({ label: `${app[1]} application ${app[2]} (raw)`, value: app[3] });
		} else unconsumed.push(part);
	}
	values.applications = applications;
	fields.push({ label: 'Application checksum', value: `${checksum} · Unverified` });
	return result(
		{
			protocol: 'AFN',
			variant: 'Afn',
			values,
			raw: message.text,
			unconsumed,
			integrity: { status: 'unverified', checksum },
			source: source('arinc622/afn'),
		},
		'ATS facilities notification',
		fields,
	);
}

export function interpretAtis(message: AcarsRecord): AcarsInterpretation | undefined {
	if (message.label === 'B9' && message.direction === 'downlink') return atisRequest(message);
	if (message.label === 'A9' && message.direction === 'uplink') return atisDelivery(message);
}

function atisRequest(message: AcarsRecord): AcarsInterpretation | undefined {
	const match = /^(?:[A-Z0-9]{3,12})?\/([A-Z]{4})\.TI2\/(\d{3})([A-Z]{4})([A-Z])([A-F0-9]{4})$/.exec(
		message.text.trim(),
	);
	if (!match || match[1] !== match[3]) return;
	const [, airport, offset, , currentAtis, checksum] = match;
	return result(
		{
			protocol: 'TI2',
			variant: 'AtisRequest',
			values: { airport, offset: Number(offset), currentAtis },
			raw: message.text,
			unconsumed: [],
			integrity: { status: 'unverified', checksum },
			source: source('arinc623/atis'),
		},
		'ATIS request',
		[
			{ label: 'Requested airport (ICAO)', value: airport },
			{ label: 'Current ATIS information', value: currentAtis },
			{ label: 'Requested byte offset', value: String(Number(offset)) },
			{ label: 'Application checksum', value: `${checksum} · Unverified` },
		],
	);
}

function atisDelivery(message: AcarsRecord): AcarsInterpretation | undefined {
	const match =
		/^(?:[A-Z0-9]{3,12})?\/([A-Z0-9]{4,7})\.TI2\/([A-Z]{4})[ \t]+(ARR|DEP)[ \t]+ATIS[ \t]+([A-Z])\r?\n([^]+)$/.exec(
			message.text.trim(),
		);
	if (!match) return;
	const [, facility, airport, kind, letter, rawBody] = match;
	// A checksum must be on its own line. A weather token such as Q1018 is not a checksum.
	const checksum = /(?:\r?\n)[ \t]*([A-F0-9]{4})$/.exec(rawBody)?.[1];
	const body = checksum ? rawBody.replace(/\r?\n[ \t]*[A-F0-9]{4}$/, '').trim() : rawBody.trim();
	const issuedTime = /\b((?:[01]\d|2[0-3])[0-5]\dZ)\b/.exec(body)?.[1];
	const values: AtsResult['values'] = { facility, airport, kind, atisLetter: letter, text: body };
	if (issuedTime) values.issuedTime = issuedTime;
	return result(
		{
			protocol: 'TI2',
			variant: 'AtisDelivery',
			values,
			raw: message.text,
			unconsumed: [],
			integrity: { status: 'unverified', checksum },
			source: source('arinc623/atis'),
		},
		'ATIS delivery',
		[
			{ label: 'ATIS Airport', value: airport },
			{ label: 'ATIS kind', value: kind === 'ARR' ? 'Arrival' : 'Departure' },
			{ label: 'ATIS information', value: letter },
			...(issuedTime
				? [
						{
							label: 'ATIS issued time',
							value: `${issuedTime.slice(0, 2)}:${issuedTime.slice(2, 4)} UTC (date not supplied)`,
						},
					]
				: []),
			{ label: 'ATIS text', value: body },
			...(checksum ? [{ label: 'Application checksum', value: `${checksum} · Unverified` }] : []),
		],
	);
}

export function interpretOceanic(message: AcarsRecord): AcarsInterpretation | undefined {
	const match = /^(?:[A-Z0-9]{3,12})?\/([A-Z0-9]{4,7})\.OC1\/([A-Z]{3})[ \t]+(\d+)(?:\r?\n|\\r\\n)([^]+)$/.exec(
		message.text.trim(),
	);
	if (!match) return;
	const [, facility, type, number, rest] = match;
	const lines = rest
		.split(/\r?\n|\\r\\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const entry = /^([A-Z0-9]+)-([A-Z0-9]+)\/((?:[01]\d|2[0-3])[0-5]\d)[ \t]+M(\d{3})F(\d{3})$/.exec(lines[0]);
	if (!entry) return;
	const [, flight, point, clock, mach, level] = entry;
	const remarks = lines
		.slice(1)
		.find((line) => line.startsWith('-RMK/'))
		?.slice(5);
	const values: AtsResult['values'] = {
		facility,
		clearanceType: type,
		clearanceNumber: number,
		flight,
		entryPoint: point,
		entryTime: clock,
		mach: Number(mach) / 100,
		flightLevel: Number(level),
	};
	if (remarks) values.remarks = remarks;
	return result(
		{
			protocol: 'OC1',
			variant: 'OceanicClearance',
			values,
			raw: message.text,
			unconsumed: lines.slice(1).filter((line) => !line.startsWith('-RMK/')),
			integrity: { status: 'unverified' },
			source: source('arinc622/oceanic'),
		},
		'Oceanic clearance message',
		[
			{ label: 'Ground address', value: facility },
			{ label: 'Clearance type', value: type },
			{ label: 'Clearance number', value: number },
			{ label: 'Reported flight', value: flight },
			{ label: 'Oceanic entry point', value: point },
			{ label: 'Oceanic entry time', value: `${clock.slice(0, 2)}:${clock.slice(2)} UTC (date not supplied)` },
			{ label: 'Requested Mach', value: (Number(mach) / 100).toFixed(2) },
			{ label: 'Requested flight level', value: `FL${level}` },
			...(remarks ? [{ label: 'Remarks (raw)', value: remarks }] : []),
		],
	);
}

export function interpretAts(message: AcarsRecord): AcarsInterpretation | undefined {
	return interpretAfn(message) ?? interpretAtis(message) ?? interpretOceanic(message);
}
