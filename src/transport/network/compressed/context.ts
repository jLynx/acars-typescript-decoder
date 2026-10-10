// Independent Mobile SNDCF context setup from ICAO ATTF/5 IP/11 (2003) §§2.2–2.3.
import type { ClnpCompressedContext, ClnpPdu } from '@/transport/network/types';
import type {
	ClnpCompressedReception,
	ClnpCompressedReassembler,
	ClnpContextObservation,
	ClnpReassemblyOptions,
} from '@/transport/network/types';
import type { CompressedContextRecord } from './types';
import { decodeClnp } from '@/transport/network/clnp';

export function validateContext(context: ClnpCompressedContext): void {
	if (!Number.isInteger(context.localReference) || context.localReference < 0 || context.localReference > 32767)
		throw new RangeError('Invalid compressed CLNP local reference');
	for (const address of [context.source, context.destination])
		if (!(address instanceof Uint8Array) || address.length < 1 || address.length > 20)
			throw new RangeError('Invalid NSAP context');
	if (
		context.priority !== undefined &&
		(!Number.isInteger(context.priority) || context.priority < 0 || context.priority > 14)
	)
		throw new RangeError('Invalid compression-context priority');
}

export function observeContext(
	bytes: Uint8Array,
	reception: ClnpCompressedReception,
	options: ClnpReassemblyOptions,
	ordered: boolean,
	retention: number,
	lookup: (context: ClnpCompressedContext) => CompressedContextRecord | undefined,
	open: ClnpCompressedReassembler['open'],
): ClnpContextObservation {
	const packet = decodeClnp(bytes, options);
	if (!packet) throw new TypeError('Invalid uncompressed CLNP context packet');
	const result = { packet, discarded: [] as string[] };
	if (!ordered || reception.linkIntegrity !== 'verified' || packet.integrity !== 'verified')
		return {
			...result,
			status: 'failed',
			reason: 'Context requires ordered reception and verified network/link integrity.',
		};
	try {
		const context = contextFromClnp(packet, reception.link);
		if (!context) return { ...result, status: 'ignored', reason: 'No supported local-reference context option.' };
		const existing = lookup(context);
		if (
			existing &&
			reception.receivedAt - existing.firstAt < retention &&
			JSON.stringify(existing.context) === JSON.stringify(context)
		)
			return { ...result, status: 'duplicate', context: structuredClone(context) };
		return { ...result, status: 'registered', context, discarded: open(context, reception.receivedAt) };
	} catch (error) {
		return { ...result, status: 'failed', reason: error instanceof Error ? error.message : 'Invalid context.' };
	}
}

export function contextFromClnp(packet: ClnpPdu, link: string): ClnpCompressedContext | undefined {
	const references = packet.options?.filter((option) => option.id === 5) ?? [];
	if (!references.length) return;
	if (references.length !== 1 || !packet.lifetime || packet.type !== 'Data' || packet.more || packet.offset)
		throw new Error('Ambiguous or incomplete local-reference setup.');
	const reference = references[0].raw;
	if (!reference.length || reference.length > 2) throw new Error('Unsupported local-reference width.');
	const localReference = reference.reduce((sum, byte) => sum * 256 + byte, 0);
	if (localReference > 32767) throw new Error('Local reference exceeds compressed header capacity.');
	const priorities = packet.options!.filter((option) => option.id === 0xcd);
	const security = packet.options!.filter((option) => option.id === 0xc5);
	if (priorities.length > 1 || security.length > 1 || packet.options!.some((option) => option.reason))
		throw new Error('Invalid compression-context options.');
	return {
		link,
		localReference,
		source: packet.source!.slice(),
		destination: packet.destination!.slice(),
		version: packet.raw[2],
		priority: priorities[0]?.raw[0] ?? 0,
		security: security[0]?.raw.slice(),
	};
}
