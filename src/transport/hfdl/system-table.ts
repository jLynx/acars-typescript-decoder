// SPDX-License-Identifier: GPL-3.0-or-later
// Table layout adapted from szpajder/dumphfdl src/systable.c, revision in docs/upstreams.json.
// Bounds, validation and streaming state are locally authored. Original license is bundled.
import { decodeHfdl } from './decode';
import type {
	HfdlSystemTable,
	HfdlSystemTableAssembler,
	HfdlSystemTableEvent,
	HfdlSystemTableOptions,
	HfdlSystemTableReception,
	HfdlSystemTableSet,
	HfdlSystemTableStation,
} from './types';

const coordinate = (value: number) => ((value >= 0x80000 ? value - 0x100000 : value) * 180) / 0x7ffff;

/** Complete D0 message body, after concatenation in fragment-index order; excludes every five-byte D0 header. */
export function decodeHfdlSystemTable(bytes: Uint8Array, version: number): HfdlSystemTable {
	if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 65535)
		throw new RangeError('HFDL system table must contain 1–65535 bytes');
	if (!Number.isInteger(version) || version < 0 || version > 4095) throw new RangeError('Invalid HFDL table version');
	const result: HfdlSystemTable = {
		version,
		stations: [],
		raw: bytes.slice(),
		unconsumed: new Uint8Array(),
		status: 'decoded',
	};
	let position = 0;
	try {
		while (position < bytes.length) {
			const station = decodeStation(bytes.subarray(position));
			if (result.stations.some((item) => item.id === station.id)) throw new Error('Duplicate ground station ID.');
			result.stations.push(station);
			position += station.raw.length;
		}
	} catch (error) {
		result.status = 'failed';
		result.reason = error instanceof Error ? error.message : 'Invalid table.';
		result.unconsumed = bytes.slice(position);
	}
	return result;
}

function decodeStation(bytes: Uint8Array): HfdlSystemTableStation {
	if (bytes.length < 7) throw new Error('Truncated ground station record.');
	const count = bytes[6] >>> 3;
	const length = 7 + count * 4;
	if (count > 20 || bytes.length < length) throw new Error('Invalid or truncated frequency list.');
	const latitude = coordinate(bytes[1] + bytes[2] * 256 + (bytes[3] & 15) * 65536);
	const longitude = coordinate((bytes[3] >>> 4) + bytes[4] * 16 + bytes[5] * 4096);
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid ground station coordinates.');
	const frequencies: HfdlSystemTableStation['frequencies'] = [];
	for (let index = 0; index < count; index++) {
		const raw = bytes.slice(7 + index * 4, 11 + index * 4);
		let frequency = 0;
		for (let digit = 0; digit < 6; digit++) {
			const value = (raw[digit >>> 1] >>> ((digit & 1) * 4)) & 15;
			if (value > 9) throw new Error('Invalid BCD frequency.');
			frequency += value * 10 ** (digit + 2);
		}
		frequencies.push({ frequency, unit: 'Hz', masterFrameSlot: raw[3] & 15, raw });
	}
	return {
		id: bytes[0] & 127,
		utcSynchronized: Boolean(bytes[0] & 128),
		position: { latitude, longitude, unit: 'deg' },
		spduVersion: bytes[6] & 7,
		frequencies,
		raw: bytes.slice(0, length),
	};
}

function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new RangeError('Invalid HFDL table limit');
	return result;
}

function validateReception(reception: HfdlSystemTableReception): void {
	if (
		typeof reception.source !== 'string' ||
		!reception.source ||
		reception.source.length > 240 ||
		reception.source.includes('\0') ||
		!Number.isFinite(reception.receivedAt)
	)
		throw new TypeError('Invalid HFDL table reception');
}

function selectTable(
	event: HfdlSystemTableEvent,
	source: string,
	current: Map<string, HfdlSystemTable>,
	maximum: number,
): void {
	if (event.table?.status !== 'decoded') return;
	const previous = current.get(source);
	event.selected = !previous || isHfdlTableNewer(event.version, previous.version);
	if (!event.selected) return;
	if (!previous && current.size >= maximum) current.delete(current.keys().next().value!);
	current.set(source, structuredClone(event.table));
}

/** Version comparison in the 12-bit serial space. Exactly half a cycle is ambiguous and never replaces state. */
export function isHfdlTableNewer(candidate: number, current: number): boolean {
	for (const value of [candidate, current])
		if (!Number.isInteger(value) || value < 0 || value > 4095) throw new RangeError('Invalid HFDL table version');
	const distance = (candidate - current + 4096) % 4096;
	return distance > 0 && distance < 2048;
}

export function createHfdlSystemTableAssembler(options: HfdlSystemTableOptions = {}): HfdlSystemTableAssembler {
	const maxSets = limit(options.maxSets, 64, 256),
		maxBytes = limit(options.maxBytes, 65535, 65535);
	const retention = limit(options.retentionMs, 60000, 3600000);
	const sets = new Map<string, HfdlSystemTableSet>();
	const current = new Map<string, HfdlSystemTable>();
	let watermark = -Infinity;
	return {
		push(bytes, reception) {
			validateReception(reception);
			const frame = decodeHfdl(bytes),
				events: HfdlSystemTableEvent[] = [],
				discarded: string[] = [];
			if (reception.receivedAt < watermark) throw new RangeError('HFDL reception time moved backwards');
			watermark = reception.receivedAt;
			for (const [key, set] of sets)
				if (watermark - set.firstAt >= retention) {
					sets.delete(key);
					discarded.push(key);
				}
			for (const aircraft of frame.mpdu?.aircraft ?? [])
				for (const lpdu of aircraft.lpdus) {
					const fragment = lpdu.hfnpdu?.systemTable;
					if (lpdu.integrity !== 'verified' || !fragment) continue;
					const key = JSON.stringify([reception.source, fragment.version, fragment.total]);
					let set = sets.get(key);
					if (!set) {
						if (sets.size >= maxSets) {
							const oldest = sets.keys().next().value!;
							sets.delete(oldest);
							discarded.push(oldest);
						}
						set = { source: reception.source, ...fragment, firstAt: watermark, parts: new Map(), length: 0 };
						sets.set(key, set);
					}
					const event = append(set, fragment.sequence, lpdu.hfnpdu!.raw.subarray(5), maxBytes);
					if (event.status === 'failed' && current.get(reception.source)?.version === event.version)
						current.delete(reception.source);
					selectTable(event, reception.source, current, maxSets);
					events.push(event);
				}
			return { frame, events, discarded };
		},
		current: (source) => {
			const table = current.get(source);
			return table && structuredClone(table);
		},
		reset(source) {
			for (const [key, set] of sets) if (source === undefined || source === set.source) sets.delete(key);
			if (source === undefined) {
				current.clear();
				watermark = -Infinity;
			} else current.delete(source);
		},
		stats: () => ({
			sets: sets.size,
			bytes: [...sets.values()].reduce((sum, set) => sum + set.length, 0),
			sources: current.size,
		}),
	};
}

function append(set: HfdlSystemTableSet, sequence: number, bytes: Uint8Array, maximum: number): HfdlSystemTableEvent {
	const result: HfdlSystemTableEvent = {
		status: 'pending',
		version: set.version,
		total: set.total,
		sequence,
		fragments: set.parts.size,
	};
	const previous = set.parts.get(sequence);
	if (previous && previous.length === bytes.length && previous.every((byte, index) => byte === bytes[index]))
		return { ...result, status: set.failure ? 'failed' : 'duplicate', reason: set.failure };
	if (previous) set.failure = 'Conflicting duplicate fragment.';
	if (!bytes.length || set.length + bytes.length > maximum)
		set.failure = 'Empty fragment or table byte limit exceeded.';
	if (set.failure) return { ...result, status: 'failed', reason: set.failure };
	set.parts.set(sequence, bytes.slice());
	set.length += bytes.length;
	result.fragments++;
	if (set.parts.size !== set.total) return result;
	const body = new Uint8Array(set.length);
	let offset = 0;
	for (let index = 0; index < set.total; index++) {
		const part = set.parts.get(index)!;
		body.set(part, offset);
		offset += part.length;
	}
	result.table = decodeHfdlSystemTable(body, set.version);
	result.status = result.table.status === 'failed' ? 'failed' : 'complete';
	result.reason = result.table.reason;
	set.complete = result.status === 'complete';
	return result;
}
