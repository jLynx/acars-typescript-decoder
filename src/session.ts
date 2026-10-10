import { createDecoder, normalize } from './api';
import type { DecoderSession, DecoderSessionOptions, DecoderSourceState } from './types';

function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		throw new RangeError('Invalid decoder session limit');
	return result;
}

/** Bounded source windows reuse batch decoders, preserving consistent batch/stream behavior. */
export function createDecoderSession(options: DecoderSessionOptions = {}): DecoderSession {
	const decoder = createDecoder(options);
	const maxSources = limit(options.maxSources, 16, 128);
	const maxRecords = limit(options.maxRecords, 512, 10000);
	const maxCharacters = limit(options.maxCharacters, 1_048_576, 8_388_608);
	const retentionMs = limit(options.retentionMs, 1_200_000, 3_600_000);
	const sources = new Map<string, DecoderSourceState>();
	let nextId = 1,
		evictedRecords = 0;
	return {
		push(input, source = 'default') {
			if (typeof source !== 'string' || !source || source.length > 240)
				throw new TypeError('Invalid source identifier');
			const message = normalize({ ...input, id: input.id ?? nextId });
			const previous = sources.get(source);
			if (previous?.records.some((record) => record.id === message.id))
				throw new TypeError('Record IDs must be unique within a source session');
			nextId = Math.max(nextId, message.id + 1);
			if (!previous && sources.size >= maxSources) {
				const oldest = sources.keys().next().value!;
				evictedRecords += sources.get(oldest)!.records.length;
				sources.delete(oldest);
			}
			const state = previous ?? { records: [], highWatermark: message.receivedAt };
			state.highWatermark = Math.max(state.highWatermark, message.receivedAt);
			const retained = state.records.filter((record) => state.highWatermark - record.receivedAt <= retentionMs);
			evictedRecords += state.records.length - retained.length;
			if (state.highWatermark - message.receivedAt <= retentionMs) retained.push(message);
			else evictedRecords++;
			retained.sort((a, b) => a.receivedAt - b.receivedAt || a.id - b.id);
			let characters = retained.reduce((sum, record) => sum + record.text.length, 0);
			while (retained.length > maxRecords || characters > maxCharacters) {
				characters -= retained.shift()!.text.length;
				evictedRecords++;
			}
			state.records = retained;
			sources.delete(source);
			sources.set(source, state);
			const result = decoder.decodeLog(retained).find((record) => record.id === message.id);
			if (!result) return { ...message, interpretation: decoder.decode(message) };
			return result;
		},
		reset(source) {
			if (source === undefined) sources.clear();
			else sources.delete(source);
		},
		snapshot(source = 'default') {
			return decoder.decodeLog(sources.get(source)?.records ?? []);
		},
		stats() {
			const records = [...sources.values()].flatMap((state) => state.records);
			return {
				sources: sources.size,
				records: records.length,
				characters: records.reduce((sum, record) => sum + record.text.length, 0),
				evictedRecords,
			};
		},
	};
}
