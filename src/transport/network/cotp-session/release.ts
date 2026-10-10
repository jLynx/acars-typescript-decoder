// X.224 §§6.6/6.7: capture-side lifecycle evidence; never transmits DR/DC.
import type { CotpPdu, CotpSessionEvent, CotpSessionReception } from '@/transport/network/types';
import type { CotpRelease } from '@/transport/network/types';
import type { SessionConnection } from './types';
import { opposite } from './acknowledge';
import { sameConnect } from './negotiate';
import { parameter } from './parameters';

export function errorEvent(record: SessionConnection, pdu: CotpPdu): CotpSessionEvent {
	if (pdu.rejectCause! > 3 || pdu.parameters.some((part) => ![8, 9, 0xc1, 0xc3].includes(part.id)))
		throw new Error('Invalid ER cause/parameter.');
	const rejectedHeader = parameter(pdu, 0xc1);
	if (rejectedHeader && !rejectedHeader.length) throw new Error('Empty rejected TPDU header.');
	const pendingRequestReleased = record.state === 'pending';
	return {
		status: pendingRequestReleased ? 'closed' : 'ignored',
		connectionId: record.id,
		reason: pendingRequestReleased
			? 'ER received in response to a pending CR.'
			: 'Observed ER; release requires separate wire evidence.',
		transportError: { cause: pdu.rejectCause!, rejectedHeader: rejectedHeader?.slice(), pendingRequestReleased },
	};
}

export function releaseRecord(
	records: SessionConnection[],
	pdu: CotpPdu,
	reception: CotpSessionReception,
): SessionConnection | undefined {
	return records.find((record) => {
		if (record.link !== reception.link) return false;
		const previous = record.releases?.[reception.direction] ?? record.confirmations?.[reception.direction];
		if (
			previous &&
			pdu.destinationReference === previous.destinationReference &&
			pdu.sourceReference === previous.sourceReference
		)
			return true;
		const other = record.releases?.[opposite(reception.direction)];
		if (
			other &&
			pdu.destinationReference === other.sourceReference &&
			pdu.sourceReference === other.destinationReference
		)
			return true;
		const fromInitiator = reception.direction === record.direction;
		const destination = fromInitiator ? record.responder : record.initiator;
		const source = fromInitiator ? record.initiator : record.responder;
		if (record.state === 'pending') {
			return (
				pdu.type === 0x80 &&
				(fromInitiator
					? pdu.destinationReference === 0 && pdu.sourceReference === record.initiator
					: pdu.destinationReference === record.initiator)
			);
		}
		return pdu.destinationReference === destination && pdu.sourceReference === source;
	});
}

export function releaseEvent(
	record: SessionConnection,
	pdu: CotpPdu,
	reception: CotpSessionReception,
): CotpSessionEvent {
	if ((pdu.userData?.length ?? 0) > 64) throw new Error('Disconnect user data exceeds 64 octets.');
	if (pdu.parameters.some((part) => ![8, 9, 0xc3, 0xe0].includes(part.id)))
		throw new Error('Unsupported disconnect parameter.');
	if (pdu.type === 0xc0 && pdu.parameters.some((part) => ![8, 9, 0xc3].includes(part.id)))
		throw new Error('Unsupported DC parameter.');
	const direction = reception.direction;
	record.releases ??= {};
	record.confirmations ??= {};
	const retained = pdu.type === 0x80 ? record.releases : record.confirmations;
	const previous = retained[direction];
	if (previous && !sameConnect(previous, pdu)) throw new Error('Conflicting retransmitted disconnect.');
	const stage = releaseStage(record, pdu, direction);
	retained[direction] = structuredClone(pdu);
	if (stage === 'refused' && pdu.sourceReference) record.responder = pdu.sourceReference;
	return {
		status: previous ? 'duplicate' : record.state === 'frozen' ? 'acknowledged' : 'closed',
		connectionId: record.id,
		release: { stage, direction, reasonCode: pdu.disconnectReason, userData: pdu.userData?.slice() },
	};
}

function releaseStage(
	record: SessionConnection,
	pdu: CotpPdu,
	direction: CotpSessionReception['direction'],
): CotpRelease['stage'] {
	if (pdu.type === 0x80 && !record.confirm) return direction === record.direction ? 'cancelled' : 'refused';
	const other = record.releases?.[opposite(direction)];
	if (pdu.type === 0xc0) return other ? 'confirmed' : 'unmatched-confirmation';
	return other ? 'crossed' : 'requested';
}
