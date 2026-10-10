// Passive X.224 §§12.2.3.6/7/9 and 13.9/10; never generates transport packets.
import type { CotpPdu, CotpSessionEvent, CotpSessionReception, CotpWindow } from '@/transport/network/types';
import type { SessionConnection } from './types';
import { integer, parameter } from './parameters';
import { retainSelective, selectiveBlocks } from './selective';

export const opposite = (direction: CotpSessionReception['direction']): CotpSessionReception['direction'] =>
	direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';

function confirmation(pdu: CotpPdu): CotpWindow | undefined {
	const bytes = parameter(pdu, 0x8c);
	if (!bytes) return;
	if (bytes.length !== 8) throw new Error('Invalid flow control confirmation length.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const normal = pdu.format === 'normal';
	const lower = view.getUint32(0) & (normal ? 127 : 0x7fffffff);
	const credit = view.getUint16(6) & (normal ? 15 : 65535);
	return { lower, upper: (lower + credit) % (normal ? 128 : 2 ** 31), credit, subsequence: view.getUint16(4) };
}

function matches(a: CotpWindow, b: CotpWindow): boolean {
	return a.lower === b.lower && a.credit === b.credit && a.subsequence === b.subsequence;
}

export function acknowledge(
	record: SessionConnection,
	pdu: CotpPdu,
	reception: CotpSessionReception,
): CotpSessionEvent {
	const direction = opposite(reception.direction);
	const basic: CotpSessionEvent = { status: 'ignored', connectionId: record.id };
	if (pdu.type === 0x20) {
		const event = expeditedAck(record, pdu, direction);
		if (event.status === 'acknowledged') record.lastAt = reception.receivedAt;
		return event;
	}
	if (pdu.parameters.some((part) => ![8, 9, 0xc3, 0x8a, 0x8c, 0x8f].includes(part.id)))
		throw new Error('Unsupported acknowledgement parameter; retained raw.');
	const modulus = pdu.format === 'normal' ? 128 : 2 ** 31;
	const previous = record.windows![direction];
	const lower = pdu.receiveSequence!;
	const subsequence = integer(pdu, 0x8a, 2) ?? 0;
	const credit = pdu.credit!;
	const echoed = confirmation(pdu);
	const blocks = selectiveBlocks(pdu, record.negotiation!.selectiveAcknowledgement);
	const delta = (lower - previous.lower + modulus) % modulus;
	if (
		delta >= modulus / 2 ||
		(!delta &&
			(subsequence < previous.subsequence || (subsequence === previous.subsequence && credit < previous.credit)))
	)
		return { ...basic, reason: 'Out-of-sequence acknowledgement does not change the retained window.' };
	const window: CotpWindow = { lower, upper: (lower + credit) % modulus, credit, subsequence };
	const dataObserved = (record.chains![direction].next - lower + modulus) % modulus < modulus / 2;
	const duplicate = matches(window, previous);
	record.selective![direction] = retainSelective(record.selective![direction], blocks, lower, modulus);
	record.windows![direction] = window;
	record.lastAt = reception.receivedAt;
	return {
		...basic,
		status: duplicate ? 'duplicate' : 'acknowledged',
		acknowledgement: {
			direction,
			service: 'normal',
			sequence: lower,
			window: { ...window },
			dataObserved,
			selectiveBlocks: record.selective![direction].map((block) => ({ ...block })),
			flowControlConfirmed: echoed && matches(echoed, record.windows![reception.direction]),
		},
	};
}

function expeditedAck(
	record: SessionConnection,
	pdu: CotpPdu,
	direction: CotpSessionReception['direction'],
): CotpSessionEvent {
	if (!record.negotiation!.expedited) throw new Error('Expedited acknowledgement without negotiated service.');
	if (pdu.parameters.some((part) => ![8, 9, 0xc3].includes(part.id)))
		throw new Error('Unsupported expedited acknowledgement parameter.');
	const state = record.expedited![direction];
	const sequence = pdu.receiveSequence!;
	const acknowledgement = {
		direction,
		service: 'expedited' as const,
		sequence,
		dataObserved: state.pending === sequence,
	};
	if (state.pending !== sequence)
		return {
			status: 'ignored',
			connectionId: record.id,
			acknowledgement,
			reason: state.sent ? 'No observed outstanding ED matches this EA.' : 'EA arrived without an observed ED.',
		};
	state.pending = undefined;
	state.acknowledged = sequence;
	return { status: 'acknowledged', connectionId: record.id, acknowledgement };
}
