import { decodeAeroAcars } from './acars';
import { decodeAeroSignalUnit } from './decode';
import type { AeroAssembly, AeroChain, AeroOptions, AeroReassembler, AeroReception, AeroSignalUnit } from './types';

function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		throw new RangeError('Invalid Aero assembly limit');
	return result;
}
function validate(reception: AeroReception): void {
	if (
		typeof reception.link !== 'string' ||
		!reception.link ||
		reception.link.length > 240 ||
		reception.link.includes('\0') ||
		!Number.isFinite(reception.receivedAt) ||
		!['uplink', 'downlink'].includes(reception.direction)
	)
		throw new TypeError('Invalid Aero reception');
}

/** Demodulated SU assembly; voice/control bodies stay raw. No audio/IQ processing or active radio responses. */
export function createAeroReassembler(options: AeroOptions = {}): AeroReassembler {
	const maximum = limit(options.maxMessages, 64, 256),
		maxBytes = limit(options.maxBytes, 8192, 8192),
		retention = limit(options.retentionMs, 60000, 3600000);
	const chains = new Map<string, AeroChain>();
	let watermark = -Infinity;
	return {
		push(bytes, channel, reception) {
			validate(reception);
			const unit = decodeAeroSignalUnit(bytes, channel);
			const result: AeroAssembly = { status: 'ignored', unit, fragments: 0, discarded: [] };
			if (reception.receivedAt < watermark) return failed(result, 'Aero reception time moved backwards.');
			watermark = reception.receivedAt;
			for (const [key, chain] of chains)
				if (watermark - chain.firstAt >= retention) {
					chains.delete(key);
					result.discarded.push(key);
				}
			if (unit.integrity !== 'verified') return failed(result, 'Aero SU checksum failed.');
			if (unit.sequence === undefined) return result;
			const scope = JSON.stringify([reception.link, channel, reception.direction, unit.queue, unit.reference]);
			const key = channel === 'R' ? JSON.stringify([scope, unit.aircraft, unit.groundStation]) : scope;
			let chain = chains.get(key);
			if (!chain) {
				if (unit.aircraft === undefined) {
					result.reason = 'Missing P/T initial SU; aircraft/circuit context cannot be recovered.';
					return result;
				}
				if (chains.size >= maximum) {
					const oldest = chains.keys().next().value!;
					chains.delete(oldest);
					result.discarded.push(oldest);
				}
				chain = {
					link: reception.link,
					channel,
					direction: reception.direction,
					firstAt: watermark,
					aircraft: unit.aircraft,
					groundStation: unit.groundStation!,
					queue: unit.queue!,
					reference: unit.reference!,
					total: unit.total!,
					lastLength: unit.lastLength!,
					parts: new Map(),
				};
				chains.set(key, chain);
			}
			return append(chain, unit, result, maxBytes, reception);
		},
		reset(link) {
			for (const [key, chain] of chains) if (link === undefined || link === chain.link) chains.delete(key);
			if (link === undefined) watermark = -Infinity;
		},
		stats: () => ({
			messages: chains.size,
			bytes: [...chains.values()].reduce(
				(sum, chain) => sum + [...chain.parts.values()].reduce((n, p) => n + p.length, 0),
				0,
			),
		}),
	};
}

function append(
	chain: AeroChain,
	unit: AeroSignalUnit,
	result: AeroAssembly,
	maximum: number,
	reception: AeroReception,
): AeroAssembly {
	const sequence = unit.sequence!,
		previous = chain.parts.get(sequence);
	if (chain.failure) return failed(result, chain.failure);
	chain.failure = contextFailure(chain, unit);
	if (unit.channel === 'R' && sequence === chain.total - 1) chain.lastLength = unit.lastLength!;
	const length = unit.channel === 'R' ? unit.payload.length : sequence === 0 ? chain.lastLength : unit.payload.length;
	const payload = unit.payload.slice(0, length);
	if (previous) {
		if (previous.length !== payload.length || previous.some((byte, index) => byte !== payload[index]))
			chain.failure = 'Conflicting Aero retransmission.';
		else if (!chain.failure) return { ...result, status: 'duplicate', fragments: chain.parts.size };
	}
	if (chain.failure) return failed(result, chain.failure);
	if ([...chain.parts.values()].reduce((sum, part) => sum + part.length, 0) + payload.length > maximum) {
		chain.failure = 'Aero assembly byte limit exceeded.';
		return failed(result, chain.failure);
	}
	chain.parts.set(sequence, payload);
	result.fragments = chain.parts.size;
	const count = chain.channel === 'R' ? chain.total : chain.total + 1;
	if (chain.parts.size < count) return { ...result, status: 'pending' };
	const indices = Array.from({ length: count }, (_, index) => (chain.channel === 'R' ? index : chain.total - index));
	const parts = indices.map((index) => chain.parts.get(index)!);
	result.payload = Uint8Array.from(parts.flatMap((part) => [...part]));
	result.status = 'complete';
	chain.complete = true;
	result.aircraft = chain.aircraft;
	result.groundStation = chain.groundStation;
	readAcars(result, reception);
	return result;
}

function contextFailure(chain: AeroChain, unit: AeroSignalUnit): string | undefined {
	if (
		unit.total !== undefined &&
		(chain.total !== unit.total ||
			chain.aircraft !== unit.aircraft ||
			chain.groundStation !== unit.groundStation ||
			(unit.channel !== 'R' && chain.lastLength !== unit.lastLength))
	)
		return 'Aero initial/segment context conflicts.';
	if (unit.channel !== 'R' && unit.sequence! >= chain.total && unit.type !== 0x71)
		return 'Aero subsequent sequence exceeds initial count.';
}

function readAcars(result: AeroAssembly, reception: AeroReception): void {
	const bytes = result.payload!;
	if (bytes.length <= 3 || bytes[0] !== 255 || bytes[1] !== 255 || (bytes[2] & 127) !== 1) return;
	if (!result.aircraft) return;
	const acars = decodeAeroAcars(bytes, reception.direction);
	if (acars) result.acars = acars;
}
function failed(result: AeroAssembly, reason: string): AeroAssembly {
	return { ...result, status: 'failed', reason };
}
