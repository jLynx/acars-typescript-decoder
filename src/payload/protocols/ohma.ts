import type { AcarsRecord } from '@/types';
import type { AcarsInterpretation, AcarsField } from '@/payload/types';
import { isRecord } from '@/validation';
import { inflateBounded } from './miam/bytes';
import type { OhmaOuter } from './ohma/types';

/** Boeing OHMA/RYKO zlib JSON envelopes, documented by MIT xoolive/datalink. */
export function interpretOhma(message: AcarsRecord): AcarsInterpretation | undefined {
	const match = /^(?:\/(?:[A-Z0-9]{7}|[A-Z0-9]{2})\.)?(OHMA|RYKO)([^]*)$/.exec(message.text.trim());
	if (!match) return;
	const result: AcarsInterpretation = {
		title: 'Aircraft health monitoring message',
		summary: `${match[1]} compressed application message.`,
		coverage: 'partial',
		coverageDetail: 'Compressed envelope recognized',
		fields: [],
		notes: [],
	};
	try {
		if (message.continuation) throw new Error('Continued transfer requires its final ETX');
		const outer = decodeOuter(match[2]);
		if (!isRecord(outer) || typeof outer.version !== 'string' || typeof outer.message !== 'string')
			throw new Error('Unsupported OHMA outer JSON layout');
		validateOuter(outer);
		result.fields.push({ label: 'OHMA version', value: outer.version });
		for (const key of ['convo_id', 'msg_seq', 'msg_total']) {
			const value = outer[key];
			if (typeof value === 'string' || typeof value === 'number')
				result.fields.push({ label: key, value: String(value) });
		}
		if (outer.sym_key || outer.iv || outer.signature)
			throw new Error('Encrypted or signed OHMA application is unsupported');
		if (isMultipart(outer)) throw new Error('OHMA conversation parts require separate application reassembly');
		const inner: unknown = JSON.parse(outer.message);
		if (!isRecord(inner) || !isRecord(inner.data) || !Array.isArray(inner.data.airplanes))
			throw new Error('Unsupported OHMA inner JSON layout');
		appendFields(result.fields, inner, ['clientId', 'messageDate']);
		describeAirplanes(result.fields, inner.data.airplanes);
		result.fields.push({ label: 'Application JSON', value: outer.message });
		result.coverageDetail = 'Application JSON decoded · parameter units retained as transmitted';
		result.notes.push(
			'Named event values come from the transmitted JSON. Units and proprietary parameter meanings are not inferred.',
		);
	} catch (error) {
		result.notes.push(
			error instanceof Error ? error.message + '. Original transfer preserved.' : 'Application decoding failed.',
		);
	}
	return result;
}

function isMultipart(outer: Record<string, unknown>): boolean {
	return (
		(typeof outer.msg_total === 'number' && outer.msg_total > 1) ||
		(typeof outer.msg_seq === 'number' && outer.msg_seq > 1)
	);
}

function validateOuter(outer: Record<string, unknown>): void {
	for (const key of ['msg_seq', 'msg_total']) {
		const value = outer[key];
		if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 256))
			throw new Error('Invalid OHMA part count or sequence');
	}
	if (typeof outer.msg_seq === 'number' && typeof outer.msg_total === 'number' && outer.msg_seq > outer.msg_total)
		throw new Error('OHMA sequence exceeds its part count');
	if (
		outer.convo_id !== undefined &&
		(typeof outer.convo_id !== 'string' || !outer.convo_id || outer.convo_id.length > 240)
	)
		throw new Error('Invalid OHMA conversation ID');
}

function decodeOuter(encoded: string): unknown {
	if (encoded.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1)
		throw new Error('Invalid Base64 body');
	const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflateBounded(bytes, 65536, false))) as unknown;
}

/** Returns a validated cleartext conversation part after zlib integrity verification. */
export function readOhmaOuter(text: string): OhmaOuter | undefined {
	const stripped = text
		.trim()
		.replace(/^#[A-Z0-9]{2}B(?:\/[A-Z0-9]{2} )?/, '')
		.replace(/^- #[A-Z0-9]{2}(?:\/[A-Z0-9]{2} )?/, '');
	const match = /^(?:\/(?:[A-Z0-9]{7}|[A-Z0-9]{2})\.)?(OHMA|RYKO)([^]*)$/.exec(stripped);
	if (!match) return;
	try {
		const outer = decodeOuter(match[2]);
		if (
			!isRecord(outer) ||
			typeof outer.version !== 'string' ||
			typeof outer.message !== 'string' ||
			outer.sym_key ||
			outer.iv ||
			outer.signature
		)
			return;
		validateOuter(outer);
		return outer as unknown as OhmaOuter;
	} catch {
		return;
	}
}

/** Decode already-verified conversation text without recompressing it. */
export function interpretOhmaApplication(text: string): AcarsInterpretation {
	const inner: unknown = JSON.parse(text);
	if (!isRecord(inner) || !isRecord(inner.data) || !Array.isArray(inner.data.airplanes))
		throw new Error('Unsupported OHMA inner JSON layout');
	const fields: AcarsField[] = [];
	appendFields(fields, inner, ['clientId', 'messageDate']);
	describeAirplanes(fields, inner.data.airplanes);
	fields.push({ label: 'Application JSON', value: text });
	return {
		title: 'Aircraft health monitoring message',
		summary: 'Complete OHMA conversation · named application values decoded.',
		coverage: 'partial',
		coverageDetail: 'Application JSON decoded · parameter units retained as transmitted',
		fields,
		notes: [
			'Named event values come from the transmitted JSON. Units and proprietary parameter meanings are not inferred.',
		],
	};
}

function describeAirplanes(fields: AcarsField[], airplanes: unknown[]): void {
	for (const plane of airplanes) {
		if (!isRecord(plane)) continue;
		appendFields(fields, plane, ['tailNumber', 'model']);
		if (!Array.isArray(plane.flights)) continue;
		for (const flight of plane.flights as unknown[]) if (isRecord(flight)) describeFlight(fields, flight);
	}
}

function appendFields(fields: AcarsField[], object: Record<string, unknown>, keys: string[]): void {
	for (const key of keys) if (typeof object[key] === 'string') fields.push({ label: key, value: object[key] });
}

function describeFlight(fields: AcarsField[], flight: Record<string, unknown>): void {
	for (const [key, label] of [
		['departureAirportCode', 'Departure'],
		['arrivalAirportCode', 'Destination'],
		['flightNumber', 'Flight'],
		['flightLegStartTime', 'Flight leg start time'],
	]) {
		if (typeof flight[key] === 'string') fields.push({ label, value: flight[key] });
	}
	if (!Array.isArray(flight.events)) return;
	for (const event of flight.events as unknown[]) {
		if (!isRecord(event)) continue;
		appendFields(fields, event, ['eventClassId', 'eventTime', 'eventType']);
		if (!Array.isArray(event.instances)) continue;
		for (const instance of event.instances as unknown[]) {
			if (isRecord(instance) && typeof instance.name === 'string' && Array.isArray(instance.values))
				fields.push({ label: instance.name, value: JSON.stringify(instance.values) });
		}
	}
}
