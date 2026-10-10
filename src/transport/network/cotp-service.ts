// Passive class-4 ED and release rules from RFC 905 §§6.7, 12.2.3.4, 13.8.
import { acceptData, rejectCotpChain, retainedBytes } from './cotp-sequence';
import type { CotpAssembly, CotpChain, CotpConnection, CotpPdu, CotpSequenceLimits } from './types';

export function newCotpChain(connection: CotpConnection, receivedAt: number): CotpChain {
	const chain: CotpChain = {
		link: connection.link,
		format: connection.format,
		next: connection.startSequence ?? 0,
		firstSequence: connection.startSequence ?? 0,
		lastAt: receivedAt,
		queue: new Map(),
		history: [],
		parts: [],
		length: 0,
		fragments: 0,
		sourceReference: connection.sourceReference,
		atnChecksum: connection.atnChecksum,
		atnAddresses: connection.atnAddresses && structuredClone(connection.atnAddresses),
	};
	if (connection.expedited)
		chain.expedited = newCotpChain(
			{
				link: connection.link,
				destinationReference: connection.destinationReference,
				format: connection.format,
				startSequence: connection.expedited.startSequence,
			},
			receivedAt,
		);
	return chain;
}

export function cotpDeadlineStart(chain: CotpChain): number {
	const pending = Math.min(chain.firstAt ?? Infinity, chain.expedited?.firstAt ?? Infinity);
	return pending === Infinity ? chain.lastAt : pending;
}

export function cotpRetainedBytes(chain: CotpChain): number {
	return retainedBytes(chain) + (chain.expedited ? retainedBytes(chain.expedited) : 0);
}

function rejectServices(chain: CotpChain, reference: number, reason: string): void {
	rejectCotpChain(chain, reference, reason);
	if (chain.expedited) rejectCotpChain(chain.expedited, reference, reason);
}

export function processCotpService(
	chain: CotpChain,
	pdu: CotpPdu,
	receivedAt: number,
	limits: CotpSequenceLimits,
): CotpAssembly[] {
	const basic: CotpAssembly = { status: 'ignored', destinationReference: pdu.destinationReference, fragments: 0 };
	if (receivedAt < chain.lastAt) return [{ ...basic, status: 'failed', reason: 'Reception time moved backwards.' }];
	// A verified release with both references known remains useful even for a failed data stream.
	if ([0x80, 0xc0].includes(pdu.type)) {
		if (chain.sourceReference === undefined)
			return [{ ...basic, reason: 'Peer reference is required to associate a disconnect.' }];
		if (chain.sourceReference !== pdu.sourceReference)
			return [{ ...basic, reason: 'Disconnect peer reference does not match.' }];
		return [
			{
				...basic,
				status: 'closed',
				fragments:
					chain.fragments +
					chain.queue.size +
					(chain.expedited ? chain.expedited.fragments + chain.expedited.queue.size : 0),
				reason: pdu.typeName,
			},
		];
	}
	if (pdu.type === 0xf0) {
		const results = acceptData(chain, pdu, receivedAt, limits).map((result) => ({
			...result,
			service: 'normal' as const,
		}));
		if (chain.failure) rejectServices(chain, pdu.destinationReference, chain.failure);
		return results;
	}
	if (pdu.type !== 0x10)
		return [{ ...basic, reason: 'Connection negotiation/acknowledgements require caller handling.' }];
	const service = 'expedited' as const;
	if (!chain.expedited) return [{ ...basic, service, reason: 'Expedited service was not declared as negotiated.' }];
	if (chain.failure) return [{ ...basic, service, status: 'failed', reason: chain.failure }];
	const length = pdu.userData?.length ?? 0;
	if (!pdu.endOfTransmission || length < 1 || length > 16)
		return [{ ...basic, service, status: 'failed', reason: 'An expedited TSDU requires EOT and 1–16 data octets.' }];
	const results = acceptData(chain.expedited, pdu, receivedAt, {
		...limits,
		maxBytes: Math.min(limits.maxBytes, 16 * limits.windowSize),
		maxFragments: Math.min(limits.maxFragments, limits.windowSize),
	}).map((result) => ({ ...result, service }));
	chain.lastAt = receivedAt;
	if (chain.expedited.failure) rejectServices(chain, pdu.destinationReference, chain.expedited.failure);
	return results;
}
