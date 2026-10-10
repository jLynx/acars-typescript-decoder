import { decodeCotp } from '@/transport/network/cotp';
import { newCotpChain, cotpRetainedBytes, processCotpService } from '@/transport/network/cotp-service';
import { connectOffer, negotiate, sameConnect } from './negotiate';
import { cotpInputLimit } from '@/transport/network/cotp-size';
import { acknowledge } from './acknowledge';
import { isSelective } from './selective';
import { atnProfile, directedAddresses, sameAddresses } from '@/transport/network/atn/profile';
import { errorEvent, releaseEvent, releaseRecord } from './release';
import { sessionData } from './data';
import type { SessionConnection } from './types';
import type {
	CotpPdu,
	CotpResult,
	CotpSequenceLimits,
	CotpSession,
	CotpSessionEvent,
	CotpSessionOptions,
	CotpSessionReception,
	CotpSessionResult,
	CotpTransmission,
} from '@/transport/network/types';

function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		throw new RangeError('Invalid COTP session limit');
	return result;
}
const directions = ['a-to-b', 'b-to-a'] as const;

/** Passive RFC 905 class-4 negotiation and receive assembly. No active acknowledgements are generated. */
export function createCotpSession(options: CotpSessionOptions = {}): CotpSession {
	const state = new SessionState(options);
	return {
		push: (bytes, reception) => state.push(bytes, reception),
		reset: (link) => state.reset(link),
		stats: () => state.stats(),
	};
}

class SessionState {
	private readonly records = new Map<string, SessionConnection>();
	private readonly maxRecords: number;
	private readonly retention: number;
	private readonly freezeMs: number;
	private readonly limits: CotpSequenceLimits;
	private readonly maxNsduBytes: number;
	private generation = 0;
	private watermark = -Infinity;

	constructor(options: CotpSessionOptions) {
		this.maxNsduBytes = cotpInputLimit(options.maxNsduBytes);
		this.maxRecords = limit(options.maxRecords, 64, 256);
		this.retention = limit(options.retentionMs, 60000, 3600000);
		this.freezeMs = limit(options.freezeMs, 60000, 3600000);
		this.limits = {
			maxBytes: limit(options.maxBytes, 65536, 65536),
			maxFragments: limit(options.maxFragments, 128, 1024),
			windowSize: limit(options.windowSize, 32, 63),
		};
	}
	private close(record: SessionConnection, receivedAt: number, result: CotpSessionResult, reason: string): void {
		record.chains = undefined;
		record.state = 'frozen';
		record.until = receivedAt + this.freezeMs;
		result.discarded.push(record.id);
		result.events.push({ status: 'closed', connectionId: record.id, reason });
	}
	private expire(receivedAt: number, result: CotpSessionResult): void {
		this.watermark = Math.max(this.watermark, receivedAt);
		for (const record of this.records.values()) {
			if (record.state === 'frozen') {
				if (receivedAt >= record.until!) this.records.delete(record.id);
				continue;
			}
			const pending = record.chains
				? directions.flatMap((direction) => {
						const chain = record.chains![direction];
						return [chain.firstAt ?? Infinity, chain.expedited?.firstAt ?? Infinity];
					})
				: [];
			const start = record.state === 'pending' ? record.firstAt : Math.min(record.lastAt, ...pending);
			if (receivedAt - start >= this.retention)
				this.close(record, receivedAt, result, 'Connection or pending message expired.');
		}
	}
	private atPeer(
		link: string,
		direction: CotpSessionReception['direction'],
		reference: number,
	): SessionConnection | undefined {
		return [...this.records.values()].find(
			(record) =>
				record.link === link && (record.direction === direction ? record.initiator : record.responder) === reference,
		);
	}
	private request(pdu: CotpPdu, reception: CotpSessionReception, result: CotpSessionResult): CotpSessionEvent {
		if (pdu.destinationReference || pdu.rawHeader.length + 1 + (pdu.userData?.length ?? 0) > 128)
			throw new Error('Invalid connect request destination/length.');
		const offer = connectOffer(pdu);
		const existing = this.atPeer(reception.link, reception.direction, pdu.sourceReference!);
		if (existing) {
			if (existing.state === 'frozen') throw new Error('Source reference is quarantined.');
			if (existing.direction === reception.direction && sameConnect(existing.request, pdu))
				return { status: 'duplicate', connectionId: existing.id };
			this.close(existing, reception.receivedAt, result, 'Source reference conflicts with retained connection state.');
			throw new Error('Source reference conflicts with retained connection state.');
		}
		if (this.records.size >= this.maxRecords)
			throw new Error('COTP session record limit reached; reset or wait for expiry.');
		const id = `cotp-${++this.generation}`;
		this.records.set(id, {
			id,
			link: reception.link,
			direction: reception.direction,
			initiator: pdu.sourceReference!,
			firstAt: reception.receivedAt,
			lastAt: reception.receivedAt,
			state: 'pending',
			request: pdu,
			offer,
			atnChecksum: atnProfile(pdu),
			atnAddresses: reception.atnAddresses && structuredClone(reception.atnAddresses),
		});
		return { status: 'requested', connectionId: id };
	}
	private confirm(pdu: CotpPdu, reception: CotpSessionReception, result: CotpSessionResult): CotpSessionEvent {
		const other = reception.direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
		const record = this.atPeer(reception.link, other, pdu.destinationReference);
		if (!record || record.direction === reception.direction || record.state === 'frozen')
			throw new Error('No retained request matches the confirmation.');
		if (record.state === 'established') {
			if (sameConnect(record.confirm!, pdu)) return { status: 'duplicate', connectionId: record.id };
			this.close(record, reception.receivedAt, result, 'Conflicting confirmation for an established connection.');
			throw new Error('Conflicting confirmation for an established connection.');
		}
		const selection = negotiate(record.offer, pdu);
		selection.atnChecksum = record.atnChecksum;
		if (pdu.rawHeader.length + 1 + (pdu.userData?.length ?? 0) > selection.tpduSize)
			throw new Error('Confirmation exceeds negotiated TPDU size.');
		if (this.atPeer(reception.link, reception.direction, pdu.sourceReference!))
			throw new Error('Responder reference is in use or quarantined.');
		record.responder = pdu.sourceReference;
		record.confirm = pdu;
		record.negotiation = selection;
		const make = (direction: CotpSessionReception['direction']) =>
			newCotpChain(
				{
					link: record.link,
					destinationReference: direction === record.direction ? record.responder! : record.initiator,
					sourceReference: direction === record.direction ? record.initiator : record.responder,
					format: selection.format,
					expedited: selection.expedited ? {} : undefined,
				},
				reception.receivedAt,
			);
		record.chains = { 'a-to-b': make('a-to-b'), 'b-to-a': make('b-to-a') };
		const window = (credit: number) => ({ lower: 0, upper: credit, credit, subsequence: 0 });
		const reverse = record.direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
		record.windows = { 'a-to-b': window(0), 'b-to-a': window(0) };
		record.windows[record.direction] = window(selection.responderCredit);
		record.windows[reverse] = window(selection.initiatorCredit);
		record.expedited = { 'a-to-b': { sent: false }, 'b-to-a': { sent: false } };
		record.selective = { 'a-to-b': [], 'b-to-a': [] };
		record.state = 'established';
		record.lastAt = reception.receivedAt;
		return { status: 'established', connectionId: record.id, negotiation: structuredClone(selection) };
	}
	private error(pdu: CotpPdu, reception: CotpSessionReception, result: CotpSessionResult): void {
		const record = [...this.records.values()].find(
			(candidate) =>
				candidate.link === reception.link &&
				(candidate.direction === reception.direction ? candidate.responder : candidate.initiator) ===
					pdu.destinationReference,
		);
		if (!record || record.state === 'frozen') {
			result.events.push({ status: 'ignored', reason: 'No live connection matches this ER.' });
			return;
		}
		const event = errorEvent(record, pdu);
		if (event.status === 'closed') this.close(record, reception.receivedAt, result, event.reason!);
		result.events.push(event);
		return;
	}
	private handle(pdu: CotpPdu, reception: CotpSessionReception, result: CotpSessionResult): void {
		if (pdu.type === 0x70) {
			this.error(pdu, reception, result);
			return;
		}
		if ([0x80, 0xc0].includes(pdu.type)) {
			const record = releaseRecord([...this.records.values()], pdu, reception);
			if (!record) {
				result.events.push({ status: 'ignored', reason: 'No connection matches the disconnect references.' });
				return;
			}
			if (pdu.rawHeader.length + 1 + (pdu.userData?.length ?? 0) > (record.negotiation?.tpduSize ?? 128))
				throw new Error('Disconnect exceeds the connection TPDU size.');
			const event = releaseEvent(record, pdu, reception);
			if (record.state !== 'frozen') this.close(record, reception.receivedAt, result, 'Observed disconnect.');
			result.events.push(event);
			return;
		}
		if (pdu.type === 0xe0) {
			result.events.push(this.request(structuredClone(pdu), reception, result));
			return;
		}
		if (pdu.type === 0xd0) {
			result.events.push(this.confirm(structuredClone(pdu), reception, result));
			return;
		}
		const record = associated([...this.records.values()], reception, pdu.destinationReference);
		if (!record) {
			result.events.push({ status: 'ignored', reason: 'No established connection matches this direction/reference.' });
			return;
		}
		if (pdu.rawHeader.length + 1 + (pdu.userData?.length ?? 0) > record.negotiation!.tpduSize)
			throw new Error('TPDU exceeds negotiated size.');
		if ([0x60, 0x20].includes(pdu.type)) {
			result.events.push(acknowledge(record, pdu, reception));
			return;
		}
		const output = [0xf0, 0x10].includes(pdu.type)
			? sessionData(record, pdu, reception, this.limits)
			: processCotpService(record.chains![reception.direction], pdu, reception.receivedAt, this.limits);
		result.assemblies.push(
			...output.map((part) => ({
				...part,
				connectionId: record.id,
				direction: reception.direction,
				transmission: pdu.type === 0xf0 ? transmission(record, pdu, reception.direction) : undefined,
				integrity: record.negotiation!.checksum === 'required' ? ('verified' as const) : ('unverified' as const),
			})),
		);
		if (output.some((part) => part.status === 'closed' || part.status === 'failed'))
			this.close(record, reception.receivedAt, result, 'Directional connection released or rejected.');
		else if (output.some((part) => ['pending', 'complete', 'duplicate'].includes(part.status)))
			record.lastAt = reception.receivedAt;
	}
	push(bytes: Uint8Array, reception: CotpSessionReception): CotpSessionResult {
		validateReception(reception);
		if (!(bytes instanceof Uint8Array) || bytes.length < 2 || bytes.length > this.maxNsduBytes)
			throw new TypeError('Invalid COTP session NSDU');
		const packet = parseSession(bytes, reception, [...this.records.values()], this.maxNsduBytes);
		const result: CotpSessionResult = { packet, events: [], assemblies: [], discarded: [] };
		if (reception.receivedAt < this.watermark) {
			result.events.push({ status: 'failed', reason: 'NSDU reception time moved backwards.' });
			return result;
		}
		this.expire(reception.receivedAt, result);
		if (!sessionIntegrity(packet, reception, [...this.records.values()])) {
			result.events.push({ status: 'failed', reason: 'NSDU is malformed or not every TPDU checksum verifies.' });
			return result;
		}
		for (const pdu of packet.pdus) {
			try {
				this.handle(pdu, reception, result);
			} catch (error) {
				result.events.push({
					status: 'failed',
					reason: error instanceof Error ? error.message : 'Connection handling failed.',
				});
			}
		}
		return result;
	}
	reset(link?: string): void {
		for (const record of this.records.values())
			if (link === undefined || link === record.link) this.records.delete(record.id);
		if (link === undefined) this.watermark = -Infinity;
	}
	stats(): ReturnType<CotpSession['stats']> {
		const all = [...this.records.values()];
		return {
			pending: all.filter((record) => record.state === 'pending').length,
			established: all.filter((record) => record.state === 'established').length,
			frozen: all.filter((record) => record.state === 'frozen').length,
			bytes: all.reduce(
				(sum, record) =>
					sum +
					(record.chains
						? directions.reduce((total, direction) => total + cotpRetainedBytes(record.chains![direction]), 0)
						: 0),
				0,
			),
		};
	}
}

function transmission(
	record: SessionConnection,
	pdu: CotpPdu,
	direction: CotpSessionReception['direction'],
): CotpTransmission {
	const window = record.windows![direction];
	const modulus = record.negotiation!.format === 'normal' ? 128 : 2 ** 31;
	return {
		sequence: pdu.sendSequence!,
		window: { ...window },
		withinAdvertisedWindow: (pdu.sendSequence! - window.lower + modulus) % modulus < window.credit,
		awaitingExpeditedAcknowledgement:
			!record.negotiation!.nonBlockingExpedited && record.expedited![direction].pending !== undefined,
		selectivelyAcknowledged: isSelective(pdu.sendSequence!, record.selective![direction], modulus),
	};
}

function sessionIntegrity(packet: CotpResult, reception: CotpSessionReception, records: SessionConnection[]): boolean {
	if (!packet.pdus.length || packet.unconsumed.length) return false;
	return packet.pdus.every((pdu) => {
		if (pdu.atnIntegrity && pdu.atnIntegrity !== 'verified') return false;
		if (!profileMatches(pdu, reception, records)) return false;
		if (pdu.integrity === 'verified') return true;
		if (pdu.integrity === 'failed' || pdu.parameters.some((part) => part.id === 0xc3)) return false;
		if (pdu.type === 0xe0) return false;
		if (pdu.type === 0xd0) {
			const other = reception.direction === 'a-to-b' ? 'b-to-a' : 'a-to-b';
			const request = records.find(
				(record) =>
					record.link === reception.link &&
					record.direction === other &&
					record.initiator === pdu.destinationReference &&
					record.state === 'pending',
			);
			if (!request?.offer.omitChecksum) return false;
			try {
				return connectOffer(pdu).omitChecksum;
			} catch {
				return false;
			}
		}
		const record = associated(records, reception, pdu.destinationReference) ?? releaseRecord(records, pdu, reception);
		return record?.negotiation?.checksum === 'omitted';
	});
}

function validateReception(reception: CotpSessionReception): void {
	if (
		typeof reception.link !== 'string' ||
		!reception.link ||
		reception.link.length > 200 ||
		reception.link.includes('\0') ||
		!directions.includes(reception.direction) ||
		!Number.isFinite(reception.receivedAt)
	)
		throw new TypeError('Invalid COTP session reception metadata');
}
function associated(
	records: SessionConnection[],
	reception: CotpSessionReception,
	reference: number,
): SessionConnection | undefined {
	return records.find(
		(record) =>
			record.link === reception.link &&
			record.state === 'established' &&
			(record.direction === reception.direction ? record.responder : record.initiator) === reference,
	);
}
function parseSession(
	bytes: Uint8Array,
	reception: CotpSessionReception,
	records: SessionConnection[],
	maxNsduBytes: number,
): CotpResult {
	const packet: CotpResult = {
		protocol: 'COTP',
		raw: bytes.slice(),
		coverage: 'headers',
		integrity: 'unverified',
		pdus: [],
		unconsumed: new Uint8Array(),
	};
	let offset = 0;
	while (offset < bytes.length && packet.pdus.length < 128) {
		const length = bytes[offset];
		if (length < 3 || length === 255 || offset + length + 1 > bytes.length) break;
		const reference = bytes[offset + 2] * 256 + bytes[offset + 3];
		const record = records.find(
				(candidate) =>
					candidate.link === reception.link &&
					(candidate.direction === reception.direction ? candidate.responder : candidate.initiator) === reference,
			),
			high = bytes[offset + 1] & 0xf0;
		const end = [0xe0, 0xd0, 0x80, 0xf0, 0x10].includes(high) ? bytes.length : offset + length + 1;
		const parsed = decodeCotp(bytes.subarray(offset, end), {
			format: record?.negotiation?.format,
			maxNsduBytes,
			atnAddresses: sessionAddresses(reception, record),
		});
		if (!parsed?.pdus.length || parsed.unconsumed.length) break;
		packet.pdus.push(...parsed.pdus);
		if (parsed.coverage === 'partial') packet.coverage = 'partial';
		offset = end;
	}
	packet.unconsumed = bytes.slice(offset);
	if (packet.unconsumed.length) packet.coverage = 'partial';
	packet.integrity = packet.pdus.some((pdu) => pdu.integrity === 'failed')
		? 'failed'
		: packet.pdus.length && !packet.unconsumed.length && packet.pdus.every((pdu) => pdu.integrity === 'verified')
			? 'verified'
			: 'unverified';
	return packet;
}

function profileMatches(pdu: CotpPdu, reception: CotpSessionReception, records: SessionConnection[]): boolean {
	const known = records.find(
		(record) =>
			record.link === reception.link &&
			(pdu.type === 0xe0
				? record.direction === reception.direction && record.initiator === pdu.sourceReference
				: (record.direction === reception.direction ? record.responder : record.initiator) ===
					pdu.destinationReference),
	);
	if (!known) return true;
	if (atnProfile(pdu) !== known.atnChecksum) return false;
	return (
		!known.atnChecksum ||
		!reception.atnAddresses ||
		sameAddresses(
			reception.atnAddresses,
			directedAddresses(known.atnAddresses, reception.direction !== known.direction),
		)
	);
}

function sessionAddresses(
	reception: CotpSessionReception,
	record?: SessionConnection,
): CotpSessionReception['atnAddresses'] {
	return reception.atnAddresses ?? directedAddresses(record?.atnAddresses, reception.direction !== record?.direction);
}
