import type { AcarsRecord } from '@/types';
import type { AssemblyStatus } from '@/payload/types';
import type { AcarsAssembly } from '@/payload/protocols/types';

export function blockStatus(message: AcarsRecord, blocks: string[]): AssemblyStatus {
	return { protocol: 'ACARS', status: message.continuation ? 'pending' : 'complete', blocks: [...blocks] };
}

export function failureStatus(reason: string): AssemblyStatus {
	return { protocol: 'ACARS', status: /time window/.test(reason) ? 'expired' : 'failed', reason };
}

export function startChain(
	pending: Map<string, AcarsAssembly>,
	statuses: Map<number, AssemblyStatus>,
	key: string,
	message: AcarsRecord,
	block: string,
): void {
	if (!message.continuation) return;
	pending.set(key, { first: message, last: message, text: message.text, blocks: [block] });
	statuses.set(message.id, blockStatus(message, [block]));
}
