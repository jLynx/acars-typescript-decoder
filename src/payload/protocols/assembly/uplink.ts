// Uplink A–X link block sequencing from pinned MIT libacars acars.c.
import type { AcarsRecord } from '@/types';
import type { AcarsAssembly, AcarsAssemblyResult } from '@/payload/protocols/types';
import type { AssemblyStatus } from '@/payload/types';
import { blockStatus, failureStatus, startChain } from './status';

/** Uplinks have no message number; reject gaps and keep aircraft/label/source isolated. */
export function assembleUplinks(records: readonly AcarsRecord[]): AcarsAssemblyResult {
	const pending = new Map<string, AcarsAssembly>();
	const finished = new Map<string, AcarsAssembly>();
	const completed = new Map<number, AcarsAssembly>(),
		failures = new Map<number, string>();
	const statuses = new Map<number, AssemblyStatus>();
	for (const message of records) {
		if (!eligible(message)) continue;
		const key = `${message.registration}\0${message.mode}\0${message.label}`;
		const chain = pending.get(key),
			previous = finished.get(key);
		if (!chain && previous && sameBlock(previous.last, message) && withinWindow(previous, message)) {
			statuses.set(message.id, { protocol: 'ACARS', status: 'duplicate', blocks: [...previous.blocks] });
			completed.set(message.id, { ...previous, last: message });
			continue;
		}
		if (chain && sameBlock(chain.last, message) && withinWindow(chain, message)) {
			statuses.set(message.id, { protocol: 'ACARS', status: 'duplicate', blocks: [...chain.blocks] });
			chain.last = message;
			continue;
		}
		finished.delete(key);
		if (!chain) {
			startChain(pending, statuses, key, message, message.blockId);
			continue;
		}
		const expected = chain.last.blockId === 'X' ? 'A' : String.fromCharCode(chain.last.blockId.charCodeAt(0) + 1);
		const suffix = uplinkSuffix(chain.first.text, message.text, message.label);
		const failure = !withinWindow(chain, message)
			? 'Uplink exceeds the reassembly time window.'
			: message.blockId !== expected
				? `Expected uplink block ${expected}; received ${message.blockId}.`
				: suffix === undefined
					? 'H1 application prefixes do not match.'
					: chain.text.length + suffix.length > 8192 || chain.blocks.length >= 24
						? 'Uplink exceeds its size or block limit.'
						: undefined;
		if (failure) {
			statuses.set(message.id, failureStatus(failure));
			pending.delete(key);
			failures.set(message.id, failure);
			continue;
		}
		chain.text += suffix!;
		chain.last = message;
		chain.blocks.push(message.blockId);
		statuses.set(message.id, blockStatus(message, chain.blocks));
		if (!message.continuation) {
			completed.set(message.id, chain);
			finished.set(key, chain);
			pending.delete(key);
		}
	}
	return { completed, failures, statuses };
}

function eligible(message: AcarsRecord): boolean {
	return (
		message.direction === 'uplink' &&
		Boolean(message.registration) &&
		/^[A-X]$/.test(message.blockId) &&
		message.label !== '_d' &&
		Boolean(message.text)
	);
}

function sameBlock(previous: AcarsRecord, next: AcarsRecord): boolean {
	return (
		previous.blockId === next.blockId && previous.text === next.text && previous.continuation === next.continuation
	);
}

function withinWindow(chain: AcarsAssembly, next: AcarsRecord): boolean {
	const gap = next.receivedAt - chain.last.receivedAt;
	return (
		gap >= 0 &&
		gap <= 90_000 &&
		next.receivedAt - chain.first.receivedAt <= 300_000 &&
		(!chain.first.flight || !next.flight || chain.first.flight === next.flight)
	);
}

function uplinkSuffix(first: string, next: string, label: string): string | undefined {
	if (label !== 'H1') return next;
	const prefix = /^- #[A-Z0-9]{2}(?:\/[A-Z0-9]{2} )?/.exec(first)?.[0];
	const repeated = /^- #[A-Z0-9]{2}(?:\/[A-Z0-9]{2} )?/.exec(next)?.[0];
	if (!prefix && !repeated) return next;
	if (prefix !== repeated) return;
	return next.slice(repeated!.length);
}
