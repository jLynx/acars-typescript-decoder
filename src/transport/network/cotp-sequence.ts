import type { CotpAssembly, CotpChain, CotpFragment, CotpPdu, CotpSequenceLimits } from './types';

export function retainedBytes(chain: CotpChain): number {
	return chain.length + [...chain.queue.values(), ...chain.history].reduce((sum, part) => sum + part.data.length, 0);
}

function same(left: CotpFragment, right: CotpFragment): boolean {
	return (
		left.end === right.end &&
		left.expeditedSequence === right.expeditedSequence &&
		left.data.length === right.data.length &&
		left.data.every((byte, index) => byte === right.data[index])
	);
}

export function rejectCotpChain(chain: CotpChain, reference: number, reason: string): CotpAssembly[] {
	const fragments = chain.fragments + chain.queue.size;
	chain.failure = reason;
	chain.firstAt ??= chain.lastAt;
	chain.queue.clear();
	chain.history = [];
	chain.parts = [];
	chain.length = 0;
	return [{ status: 'failed', destinationReference: reference, fragments, reason }];
}

/** RFC 905 numbering/resequencing. Accept only a bounded unambiguous forward sequence window. */
export function acceptData(
	chain: CotpChain,
	pdu: CotpPdu,
	receivedAt: number,
	limits: CotpSequenceLimits,
): CotpAssembly[] {
	const reference = pdu.destinationReference;
	if (chain.failure) return rejectCotpChain(chain, reference, chain.failure);
	if (pdu.format !== chain.format)
		return rejectCotpChain(chain, reference, 'Sequence format conflicts with the connection.');
	const part: CotpFragment = {
		sequence: pdu.sendSequence!,
		end: pdu.endOfTransmission!,
		data: pdu.userData?.slice() ?? new Uint8Array(),
		expeditedSequence: pdu.expeditedSequence,
	};
	const previous =
		chain.queue.get(part.sequence) ??
		chain.parts.find((entry) => entry.sequence === part.sequence) ??
		chain.history.find((entry) => entry.sequence === part.sequence);
	chain.lastAt = receivedAt;
	if (previous) {
		if (!same(previous, part))
			return rejectCotpChain(chain, reference, 'Retransmitted sequence has conflicting data or EOT.');
		return [{ status: 'duplicate', destinationReference: reference, fragments: chain.fragments + chain.queue.size }];
	}
	const modulus = chain.format === 'normal' ? 128 : 2 ** 31;
	const distance = (part.sequence - chain.next + modulus) % modulus;
	if (distance >= limits.windowSize)
		return [
			{
				status: 'ignored',
				destinationReference: reference,
				fragments: chain.fragments + chain.queue.size,
				reason: 'Sequence is outside the configured receive window.',
			},
		];
	const queuedBytes = [...chain.queue.values()].reduce((sum, entry) => sum + entry.data.length, 0);
	if (
		chain.length + queuedBytes + part.data.length > limits.maxBytes ||
		chain.fragments + chain.queue.size >= limits.maxFragments
	)
		return rejectCotpChain(chain, reference, 'Pending messages exceed a byte or fragment limit.');
	chain.firstAt ??= receivedAt;
	chain.queue.set(part.sequence, part);
	const complete = drain(chain, reference, modulus, limits);
	if (!chain.failure && !chain.queue.size && !chain.parts.length) chain.firstAt = undefined;
	return complete.length
		? complete
		: [
				{
					status: 'pending',
					destinationReference: reference,
					fragments: chain.fragments + chain.queue.size,
					firstSequence: chain.firstSequence,
				},
			];
}

function dependencyDelivered(chain: CotpChain, part: CotpFragment, modulus: number): boolean {
	if (part.expeditedSequence === undefined) return true;
	const expedited = chain.expedited;
	if (!expedited?.history.length) return false;
	const distance = (expedited.next - part.expeditedSequence + modulus) % modulus;
	return distance > 0 && distance < modulus / 2;
}

export function resumeCotpData(chain: CotpChain, reference: number, limits: CotpSequenceLimits): CotpAssembly[] {
	const complete = drain(chain, reference, chain.format === 'normal' ? 128 : 2 ** 31, limits);
	if (!chain.queue.size && !chain.parts.length) chain.firstAt = undefined;
	return complete;
}

function drain(chain: CotpChain, reference: number, modulus: number, limits: CotpSequenceLimits): CotpAssembly[] {
	const complete: CotpAssembly[] = [];
	let part = chain.queue.get(chain.next);
	while (part) {
		if (!dependencyDelivered(chain, part, modulus)) break;
		chain.queue.delete(chain.next);
		chain.parts.push(part);
		chain.length += part.data.length;
		chain.fragments++;
		chain.next = (chain.next + 1) % modulus;
		if (chain.fragments === modulus && !part.end)
			return [...complete, ...rejectCotpChain(chain, reference, 'Incomplete message exhausts the sequence space.')];
		if (part.end) {
			const payload = new Uint8Array(chain.length);
			let offset = 0;
			for (const fragment of chain.parts) {
				payload.set(fragment.data, offset);
				offset += fragment.data.length;
			}
			complete.push({
				status: 'complete',
				destinationReference: reference,
				fragments: chain.fragments,
				firstSequence: chain.firstSequence,
				lastSequence: part.sequence,
				payload,
			});
			chain.history.push(...chain.parts);
			while (
				chain.history.length > limits.windowSize ||
				chain.history.reduce((sum, entry) => sum + entry.data.length, 0) > limits.maxBytes
			)
				chain.history.shift();
			chain.parts = [];
			chain.length = chain.fragments = 0;
			chain.firstSequence = chain.next;
		}
		part = chain.queue.get(chain.next);
	}
	return complete;
}
