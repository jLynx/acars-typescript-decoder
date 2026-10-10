import { processCotpService } from '@/transport/network/cotp-service';
import { resumeCotpData } from '@/transport/network/cotp-sequence';
import type { CotpAssembly, CotpPdu, CotpSequenceLimits } from '@/transport/network/types';
import type { SessionConnection } from './types';
import { integer } from './parameters';
import type { CotpSessionReception } from '@/transport/network/types';

export function sessionData(
	record: SessionConnection,
	pdu: CotpPdu,
	reception: CotpSessionReception,
	limits: CotpSequenceLimits,
): CotpAssembly[] {
	const direction = reception.direction;
	const chain = record.chains![direction];
	const negotiation = record.negotiation!;
	if (pdu.type === 0xf0) {
		if (pdu.requestAcknowledgement && !negotiation.requestAcknowledgement)
			throw new Error('DT requests acknowledgement without negotiated ROA.');
		if (pdu.parameters.some((part) => ![8, 9, 0xc3, 0x90].includes(part.id)))
			throw new Error('Unsupported DT parameter.');
		const dependency = integer(pdu, 0x90, pdu.format === 'normal' ? 2 : 4);
		if (dependency !== undefined) {
			if (!negotiation.nonBlockingExpedited) throw new Error('ED dependency without negotiated non-blocking service.');
			if (dependency >= (pdu.format === 'normal' ? 128 : 2 ** 31)) throw new Error('Invalid ED dependency number.');
			pdu.expeditedSequence = dependency;
		}
		return processCotpService(chain, pdu, reception.receivedAt, limits);
	}
	if (pdu.parameters.some((part) => ![8, 9, 0xc3].includes(part.id))) throw new Error('Unsupported ED parameter.');
	const state = record.expedited![direction];
	if (!chain.expedited) return processCotpService(chain, pdu, reception.receivedAt, limits);
	if (
		pdu.sendSequence !== chain.expedited.next &&
		!chain.expedited.history.some((part) => part.sequence === pdu.sendSequence)
	)
		return [
			{
				status: 'ignored',
				destinationReference: pdu.destinationReference,
				fragments: 0,
				service: 'expedited',
				reason: 'Out-of-sequence ED cannot establish delivery or an outstanding acknowledgement.',
			},
		];
	if (state.acknowledged === pdu.sendSequence && state.pending === undefined)
		return processCotpService(chain, pdu, reception.receivedAt, limits);
	if (state.pending !== undefined && state.pending !== pdu.sendSequence)
		return [
			{
				status: 'ignored',
				destinationReference: pdu.destinationReference,
				fragments: 0,
				service: 'expedited',
				reason: 'A new ED cannot replace the observed ED awaiting EA.',
			},
		];
	const results = processCotpService(chain, pdu, reception.receivedAt, limits);
	if (results.some((part) => part.status === 'complete' && part.service === 'expedited')) {
		state.pending = results.filter((part) => part.status === 'complete').at(-1)!.lastSequence;
		state.sent = true;
		results.push(
			...resumeCotpData(chain, pdu.destinationReference, limits).map((part) => ({
				...part,
				service: 'normal' as const,
			})),
		);
	}
	return results;
}
