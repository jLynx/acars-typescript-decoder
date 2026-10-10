import type { AcarsDecoder, AcarsInput, AcarsRecord, DecoderOptions } from './types';
import type { AcarsInterpretation } from './payload/types';
import { interpretAcars } from './payload/interpret';
import { interpretAcarsLog } from './payload/context';
import { describeAirports } from './payload/reference/airports';
import { validInterpretation } from './plugin-validation';

/** Normalize a received payload; reception metadata is optional for single messages. */
export function normalize(input: AcarsInput): AcarsRecord {
	validateInput(input);
	return {
		...input,
		id: input.id ?? 1,
		receivedAt: input.receivedAt ?? Date.now(),
		registration: input.registration ?? '',
		mode: input.mode ?? '',
		acknowledgement: input.acknowledgement ?? '',
		blockId: input.blockId ?? '',
		direction: input.direction ?? 'downlink',
		continuation: input.continuation ?? false,
	};
}

function validateInput(input: AcarsInput): void {
	if (typeof input?.label !== 'string' || input.label.length !== 2)
		throw new TypeError('ACARS label must contain two characters');
	if (typeof input.text !== 'string' || input.text.length > 8192)
		throw new RangeError('ACARS payload must be a string of at most 8192 characters');
	if (input.direction !== undefined && !['uplink', 'downlink'].includes(input.direction))
		throw new TypeError('Invalid ACARS direction');
	const receivedAt = input.receivedAt ?? Date.now();
	if (!Number.isFinite(receivedAt) || !Number.isFinite(new Date(receivedAt).getTime()))
		throw new RangeError('Invalid reception timestamp');
	for (const key of ['registration', 'mode', 'acknowledgement', 'blockId', 'messageNumber', 'flight'] as const) {
		if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 240))
			throw new TypeError(`Invalid ${key}`);
	}
	if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1))
		throw new TypeError('Invalid record ID');
	if (input.continuation !== undefined && typeof input.continuation !== 'boolean')
		throw new TypeError('Invalid continuation flag');
}

function pluginResult(message: AcarsRecord, options: DecoderOptions): AcarsInterpretation | undefined {
	for (const plugin of options.plugins ?? []) {
		try {
			const result = plugin.decode(Object.freeze({ ...message }));
			if (validInterpretation(result)) return describeAirports(structuredClone(result), options.airportLookup);
		} catch {
			// A third-party plugin must not stop built-in decoders or reception.
		}
	}
}

/** Plugins are checked in caller order before the built-in format decoders. */
export function createDecoder(options: DecoderOptions = {}): AcarsDecoder {
	const configuration = { ...options, plugins: [...(options.plugins ?? [])] };
	return {
		decode(input) {
			const message = normalize(input);
			return pluginResult(message, configuration) ?? interpretAcars(message, configuration.airportLookup);
		},
		decodeLog(messages) {
			if (messages.length > 10000) throw new RangeError('Decode at most 10000 blocks per batch');
			const records = messages.map(normalize);
			if (new Set(records.map((m) => m.id)).size !== records.length)
				throw new TypeError('Record IDs must be unique within a source batch');
			return interpretAcarsLog(records, configuration.airportLookup).map((result) => {
				const plugin = pluginResult({ ...result, text: result.assembledText ?? result.text }, configuration);
				if (!plugin) return result;
				plugin.notes.push(
					...result.interpretation.notes.filter(
						(note) => note.startsWith('Reassembled ') || note.startsWith('Reassembly unavailable:'),
					),
				);
				return { ...result, interpretation: plugin };
			});
		},
	};
}

const defaultDecoder = createDecoder();
export const decode = defaultDecoder.decode;
export const decodeLog = defaultDecoder.decodeLog;
