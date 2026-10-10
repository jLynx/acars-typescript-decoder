// OHMA conversation IDs and one-based sequence rules from MIT libacars ohma.c.
import type { AssemblyStatus, InterpretedAcarsRecord } from '@/payload/types';
import { readOhmaOuter, interpretOhmaApplication } from '@/payload/protocols/ohma';
import { describeAirports } from '@/payload/reference/airports';
import type { OhmaConversation, OhmaOuter } from './types';
import { applicationStatus } from '@/payload/protocols/assembly/application-status';

export function assembleOhma(
	records: InterpretedAcarsRecord[],
	airportLookup?: (code: string) => string | undefined,
): void {
	const conversations = new Map<string, OhmaConversation>();
	for (const record of records) {
		for (const [key, chain] of conversations) {
			if (record.receivedAt - chain.first.receivedAt > 1_200_000) conversations.delete(key);
		}
		if (record.continuation || !record.registration) continue;
		const outer = readOhmaOuter(record.assembledText ?? record.text);
		if (!outer?.convo_id || !outer.msg_seq) continue;
		const key = `${record.registration}\0${record.mode}\0${record.direction}\0${outer.convo_id}`;
		let chain = conversations.get(key);
		if (chain && record.receivedAt - chain.last.receivedAt > 1_200_000) {
			conversations.delete(key);
			chain = undefined;
		}
		if (!chain) {
			if (conversations.size >= 128) conversations.delete(conversations.keys().next().value!);
			chain = { first: record, last: record, version: outer.version, parts: new Map(), length: 0 };
			conversations.set(key, chain);
		}
		const failure = chain.failure ?? addPart(chain, record, outer);
		if (failure) {
			chain.failure = failure;
			chain.parts.clear();
			chain.length = 0;
			record.interpretation.notes.push(`OHMA reassembly unavailable: ${failure}`);
			applicationStatus(record, { protocol: 'OHMA', status: 'failed', identifier: outer.convo_id, reason: failure });
			continue;
		}
		if (!chain.total || chain.parts.size !== chain.total || !chain.parts.has(1)) {
			applicationStatus(record, pendingStatus(chain, outer));
			continue;
		}
		const text = Array.from({ length: chain.total }, (_, index) => chain.parts.get(index + 1) ?? '').join('');
		try {
			const result = interpretOhmaApplication(text);
			result.notes.push(
				`Reassembled OHMA conversation ${outer.convo_id}: ${chain.total} application parts. Each outer zlib stream passed integrity verification.`,
			);
			result.notes.push(...record.interpretation.notes.filter((note) => note.startsWith('Reassembled ')));
			record.interpretation = describeAirports(result, airportLookup);
			applicationStatus(record, { protocol: 'OHMA', status: 'complete', identifier: outer.convo_id });
		} catch {
			record.interpretation.notes.push('Complete OHMA conversation has invalid or unsupported application JSON.');
			applicationStatus(record, {
				protocol: 'OHMA',
				status: 'failed',
				identifier: outer.convo_id,
				reason: 'Invalid or unsupported application JSON.',
			});
		}
	}
}

function pendingStatus(chain: OhmaConversation, outer: OhmaOuter): AssemblyStatus {
	return {
		protocol: 'OHMA',
		status: 'pending',
		identifier: outer.convo_id,
		blocks: [...chain.parts.keys()].sort((a, b) => a - b).map(String),
		missing: Array.from({ length: chain.total ?? 1 }, (_, index) => index + 1)
			.filter((index) => !chain.parts.has(index))
			.map(String),
	};
}

function addPart(chain: OhmaConversation, record: InterpretedAcarsRecord, outer: OhmaOuter): string | undefined {
	if (chain.version !== outer.version) return 'Conversation versions conflict.';
	if (record.receivedAt - chain.first.receivedAt > 1_200_000)
		return 'Conversation exceeds the twenty-minute time window.';
	if (chain.first.flight && record.flight && chain.first.flight !== record.flight)
		return 'Flight identifiers conflict.';
	if (outer.msg_total !== undefined && chain.total !== undefined && outer.msg_total !== chain.total)
		return 'Part counts conflict.';
	if (outer.msg_seq === 1 && !outer.msg_total) return 'First part does not supply a total part count.';
	chain.total ??= outer.msg_total;
	if (excessSequence(chain)) return 'Earlier part number exceeds the declared count.';
	if (chain.total && outer.msg_seq! > chain.total) return 'Part number exceeds the declared count.';
	const previous = chain.parts.get(outer.msg_seq!);
	if (previous !== undefined && previous !== outer.message) return 'Retransmitted part has conflicting content.';
	if (previous === undefined) {
		if (chain.length + outer.message.length > 65_536 || chain.parts.size >= 256)
			return 'Conversation exceeds its size or part limit.';
		chain.parts.set(outer.msg_seq!, outer.message);
		chain.length += outer.message.length;
	}
	chain.last = record;
}

function excessSequence(chain: OhmaConversation): boolean {
	return chain.total !== undefined && [...chain.parts.keys()].some((sequence) => sequence > chain.total!);
}
