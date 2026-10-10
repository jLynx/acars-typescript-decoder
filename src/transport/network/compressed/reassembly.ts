// Compressed header layout cross-checked with dumpvdl2 clnp.c (pinned in docs/upstreams.json).
// Locally authored conservative context/offset engine. No missing address mapping is inferred.
import { decodeClnpCompressed } from '@/transport/network/x25';
import { decodeCotp } from '@/transport/network/cotp';
import { decodeIdrp } from '@/transport/network/idrp';
import { observeContext, validateContext } from './context';
import type {
	ClnpCompressed,
	ClnpCompressedAssembly,
	ClnpCompressedReassembler,
	ClnpReassemblyOptions,
} from '@/transport/network/types';
import type { CompressedChain, CompressedContextRecord } from './types';

const keyFor = (link: string, reference: number, priority?: number) =>
	JSON.stringify([link, reference, priority ?? null]);
function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		throw new RangeError('Invalid compressed CLNP limit');
	return result;
}
function validate(link: string, receivedAt: number): void {
	if (typeof link !== 'string' || !link || link.length > 240 || link.includes('\0') || !Number.isFinite(receivedAt))
		throw new TypeError('Invalid compressed CLNP reception');
}

function isDuplicate(chain: CompressedChain, covered: number, final: boolean): boolean {
	return chain.covered === covered && chain.final === final;
}

export function createClnpCompressedReassembler(options: ClnpReassemblyOptions = {}): ClnpCompressedReassembler {
	const maximum = limit(options.maxAssemblies, 64, 256),
		bytesLimit = limit(options.maxBytes, 8192, 8192);
	const fragments = limit(options.maxFragments, 128, 1024),
		retention = limit(options.retentionMs, 60000, 3600000);
	const contexts = new Map<string, CompressedContextRecord>(),
		chains = new Map<string, CompressedChain>();
	let watermark = -Infinity;
	const clearContext = (key: string) => {
		contexts.delete(key);
		for (const [id, chain] of chains) if (chain.contextKey === key) chains.delete(id);
	};
	const open: ClnpCompressedReassembler['open'] = (context, receivedAt) => {
		validate(context.link, receivedAt);
		validateContext(context);
		if (receivedAt < watermark) throw new RangeError('Context time moved backwards');
		watermark = receivedAt;
		const key = keyFor(context.link, context.localReference, context.priority),
			discarded: string[] = [];
		clearContext(key);
		if (contexts.size >= maximum) {
			const oldest = contexts.keys().next().value!;
			clearContext(oldest);
			discarded.push(oldest);
		}
		contexts.set(key, { context: structuredClone(context), firstAt: receivedAt });
		return discarded;
	};
	return {
		open,
		observe(bytes, reception) {
			validate(reception.link, reception.receivedAt);
			const ordered = reception.receivedAt >= watermark;
			watermark = Math.max(watermark, reception.receivedAt);
			return observeContext(
				bytes,
				reception,
				options,
				ordered,
				retention,
				(context) => contexts.get(keyFor(context.link, context.localReference, context.priority)),
				open,
			);
		},
		push(bytes, reception) {
			validate(reception.link, reception.receivedAt);
			const packet = decodeClnpCompressed(bytes, options);
			if (!packet) throw new TypeError('Invalid compressed CLNP packet');
			delete packet.cotp;
			delete packet.idrp;
			const result: ClnpCompressedAssembly = { status: 'ignored', packet, fragments: 0, discarded: [] };
			if (reception.receivedAt < watermark) return fail(result, 'Reception time moved backwards.');
			watermark = reception.receivedAt;
			result.discarded.push(...expireCompressed(chains, contexts, watermark, retention, clearContext));
			if (reception.linkIntegrity !== 'verified')
				return fail(result, 'Compressed CLNP requires verified link integrity.');
			if (!packet.lifetime) return fail(result, 'Compressed CLNP lifetime expired.');
			const exactKey = keyFor(reception.link, packet.localReference, packet.priority);
			const contextKey = contextKeyFor(contexts, exactKey, reception.link, packet.localReference);
			const context = contexts.get(contextKey);
			if (!context) {
				result.reason = 'No matching compression context.';
				return result;
			}
			result.context = structuredClone(context.context);
			if (!packet.derived) {
				result.fragments = 1;
				return finish(result, packet.payload, options);
			}
			const key = JSON.stringify([contextKey, packet.pduId]),
				previous = chains.get(key);
			if (!previous && packet.totalLength! > bytesLimit) return fail(result, 'Compressed CLNP byte limit exceeded.');
			if (!previous) result.discarded.push(...makeRoom(chains, maximum));
			const chain = previous ?? newChain(packet, contextKey, watermark, retention);
			chains.set(key, chain);
			const previousCovered = chain.covered;
			const previousFinal = chain.final;
			const reason = append(chain, packet, watermark, fragments);
			result.fragments = chain.fragments;
			if (reason) return fail(result, reason);
			if (isDuplicate(chain, previousCovered, previousFinal)) {
				result.status = 'duplicate';
				return result;
			}
			if (chain.covered === chain.data.length && chain.final) return finish(result, chain.data, options);
			result.status = 'pending';
			return result;
		},
		reset(link) {
			for (const [key, record] of contexts) if (link === undefined || record.context.link === link) clearContext(key);
			if (link === undefined) watermark = -Infinity;
		},
		stats: () => ({
			contexts: contexts.size,
			assemblies: chains.size,
			bytes: [...chains.values()].reduce((sum, chain) => sum + chain.data.length, 0),
		}),
	};
}

function newChain(packet: ClnpCompressed, contextKey: string, receivedAt: number, retention: number): CompressedChain {
	return {
		contextKey,
		firstAt: receivedAt,
		lastAt: receivedAt,
		deadline: receivedAt + Math.min(retention, packet.lifetime * 1000),
		family: packet.type < 9 ? 0 : 1,
		flags: packet.flags,
		priority: packet.priority,
		data: new Uint8Array(packet.totalLength!),
		present: new Uint8Array(packet.totalLength!),
		covered: 0,
		fragments: 0,
		final: false,
	};
}
function append(
	chain: CompressedChain,
	packet: ClnpCompressed,
	receivedAt: number,
	maximum: number,
): string | undefined {
	if (chain.failure) return chain.failure;
	const end = packet.offset! + packet.payload.length;
	let reason: string | undefined;
	if (
		chain.data.length !== packet.totalLength ||
		chain.family !== (packet.type < 9 ? 0 : 1) ||
		chain.flags !== packet.flags ||
		chain.priority !== packet.priority
	)
		reason = 'Compressed CLNP header/context conflict.';
	else if ((!packet.more && end !== chain.data.length) || (packet.more && end >= chain.data.length))
		reason = 'Invalid final/more fragment boundary.';
	let added = 0;
	for (let index = 0; index < packet.payload.length; index++) {
		const offset = packet.offset! + index;
		if (chain.present[offset]) {
			if (chain.data[offset] !== packet.payload[index]) reason = 'Compressed CLNP overlap conflict.';
		} else added++;
	}
	if (added && chain.fragments >= maximum) reason = 'Compressed CLNP fragment limit exceeded.';
	if (reason) {
		chain.failure = reason;
		chain.data = chain.present = new Uint8Array();
		return reason;
	}
	chain.deadline = Math.min(chain.deadline, receivedAt + packet.lifetime * 1000);
	chain.lastAt = receivedAt;
	chain.data.set(packet.payload, packet.offset);
	chain.present.fill(1, packet.offset, end);
	chain.covered += added;
	if (added) chain.fragments++;
	chain.final ||= !packet.more;
}
function fail(result: ClnpCompressedAssembly, reason: string): ClnpCompressedAssembly {
	return { ...result, status: 'failed', reason };
}
function finish(
	result: ClnpCompressedAssembly,
	payload: Uint8Array,
	options: ClnpReassemblyOptions,
): ClnpCompressedAssembly {
	if (payload.length > (options.maxBytes ?? 8192)) return fail(result, 'Compressed CLNP byte limit exceeded.');
	result.status = 'complete';
	result.payload = payload.slice();
	if (payload[0] === 0x85) result.idrp = decodeIdrp(payload);
	else
		result.cotp = decodeCotp(payload, {
			...options,
			atnAddresses: result.context && { source: result.context.source, destination: result.context.destination },
		});
	return result;
}

function contextKeyFor(
	contexts: Map<string, CompressedContextRecord>,
	exact: string,
	link: string,
	reference: number,
): string {
	return contexts.has(exact) ? exact : keyFor(link, reference);
}

function expireCompressed(
	chains: Map<string, CompressedChain>,
	contexts: Map<string, CompressedContextRecord>,
	watermark: number,
	retention: number,
	clear: (key: string) => void,
): string[] {
	const discarded: string[] = [];
	for (const [key, chain] of chains)
		if (watermark >= chain.deadline) {
			chains.delete(key);
			discarded.push(key);
		}
	for (const [key, context] of contexts)
		if (watermark - context.firstAt >= retention) {
			clear(key);
			discarded.push(key);
		}
	return discarded;
}

function makeRoom(chains: Map<string, CompressedChain>, maximum: number): string[] {
	if (chains.size < maximum) return [];
	const oldest = chains.keys().next().value!;
	chains.delete(oldest);
	return [oldest];
}
