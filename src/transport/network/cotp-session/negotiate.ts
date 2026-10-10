// Independent class-4 negotiation from RFC 905 and ITU-T X.224 (11/1995) §6.5.
import type { CotpNegotiation, CotpPdu } from '@/transport/network/types';
import { preferredTpduSize } from '@/transport/network/cotp-size';
import type { ConnectOffer } from './types';
import { parameter, timing } from './parameters';
import { quality } from './quality';

function single(pdu: CotpPdu, id: number, fallback: number): number {
	const bytes = parameter(pdu, id);
	if (!bytes) return fallback;
	if (bytes.length !== 1) throw new Error('Invalid connection parameter length.');
	return bytes[0];
}

function validateParameters(pdu: CotpPdu): void {
	if (
		pdu.parameters.some(
			(part) =>
				![
					8, 9, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8b, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xf0, 0xf2,
				].includes(part.id),
		)
	)
		throw new Error('Unsupported connection parameter; retained as raw data.');
	const alternatives = parameter(pdu, 0xc7);
	if (alternatives && (!alternatives.length || alternatives.some((byte) => (byte & 15) !== 0 || byte > 0x40)))
		throw new Error('Invalid alternative protocol classes.');
}

export function connectOffer(pdu: CotpPdu): ConnectOffer {
	if (pdu.protocolClass !== 4) throw new Error('Only class-4 connections are supported.');
	if (!pdu.sourceReference || (pdu.options ?? 0) & ~2) throw new Error('Invalid class-4 reference/options.');
	if ((pdu.userData?.length ?? 0) > 32) throw new Error('Connect user data exceeds 32 octets.');
	validateParameters(pdu);
	const size = single(pdu, 0xc0, 7),
		version = single(pdu, 0xc4, 1),
		additional = single(pdu, 0xc6, 1);
	if (size < 7 || size > 13 || version !== 1) throw new Error('Unsupported connection size/version/options.');
	const preferred = parameter(pdu, 0xf0);
	const preferredSize = preferred && preferredTpduSize(preferred);
	if (preferred && preferredSize === undefined) throw new Error('Invalid preferred maximum TPDU size.');
	return {
		format: pdu.options! & 2 ? 'extended' : 'normal',
		size: 2 ** size,
		preferredSize,
		requestAcknowledgement: Boolean(additional & 0x20),
		nonBlockingExpedited: Boolean(additional & 0x40),
		selectiveAcknowledgement: Boolean(additional & 0x10),
		quality: quality(pdu),
		timing: timing(pdu),
		expedited: Boolean(additional & 1),
		omitChecksum: Boolean(additional & 2),
		credit: pdu.credit ?? 0,
		calling: parameter(pdu, 0xc1)?.slice(),
		called: parameter(pdu, 0xc2)?.slice(),
	};
}

function same(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
	return (
		left === undefined ||
		right === undefined ||
		(left.length === right.length && left.every((byte, index) => byte === right[index]))
	);
}

export function negotiate(request: ConnectOffer, confirm: CotpPdu): CotpNegotiation {
	const selection = connectOffer(confirm);
	const size = negotiateSize(request, selection, confirm);
	validateSelection(request, selection);
	if (!same(request.calling, selection.calling) || !same(request.called, selection.called))
		throw new Error('Confirmation transport selectors do not match the request.');
	return {
		protocolClass: 4,
		format: selection.format,
		tpduSize: size,
		requestAcknowledgement: selection.requestAcknowledgement,
		nonBlockingExpedited: selection.nonBlockingExpedited,
		selectiveAcknowledgement: selection.selectiveAcknowledgement,
		initiatorQuality: request.quality,
		responderQuality: selection.quality,
		initiatorTiming: request.timing,
		responderTiming: selection.timing,
		expedited: selection.expedited,
		checksum: selection.omitChecksum ? 'omitted' : 'required',
		initiatorCredit: request.credit,
		responderCredit: selection.credit,
		callingSelector: request.calling?.slice() ?? selection.calling?.slice(),
		calledSelector: request.called?.slice() ?? selection.called?.slice(),
	};
}

function validateSelection(request: ConnectOffer, selection: ConnectOffer): void {
	if (selection.omitChecksum && !request.omitChecksum) throw new Error('Checksum omission was not offered.');
	if (selection.selectiveAcknowledgement && !request.selectiveAcknowledgement)
		throw new Error('Selective acknowledgement was not offered.');
	if (selection.timing.inactivityMs !== undefined && request.timing.inactivityMs === undefined)
		throw new Error('Confirmation advertises inactivity time absent from the request.');
	if (selection.requestAcknowledgement && !request.requestAcknowledgement)
		throw new Error('Confirmation selects request acknowledgement not offered.');
	if (selection.nonBlockingExpedited && (!request.nonBlockingExpedited || !selection.expedited))
		throw new Error('Invalid non-blocking expedited service selection.');
	if ((selection.format === 'extended' && request.format !== 'extended') || (selection.expedited && !request.expedited))
		throw new Error('Confirmation selects an option not offered in the request.');
}

/** X.224 §§6.5.4 k), 6.5.5 k): CC chooses either preferred size or ordinary fallback. */
function negotiateSize(request: ConnectOffer, selection: ConnectOffer, confirm: CotpPdu): number {
	if (selection.preferredSize !== undefined) {
		if (request.preferredSize === undefined || selection.preferredSize > request.preferredSize)
			throw new Error('Confirmation selects a preferred maximum TPDU size not offered.');
		if (parameter(confirm, 0xc0)) throw new Error('Confirmation includes both TPDU size parameters.');
		return selection.preferredSize;
	}
	if (selection.size > request.size) throw new Error('Confirmation selects a TPDU size not offered.');
	return selection.size;
}

export function sameConnect(left: CotpPdu, right: CotpPdu): boolean {
	// RFC 905 allows TLVs in any order and checksum zero may encode as 0 or 255.
	// Compare fixed fields and sorted non-checksum parameters, not wire order.
	const header = (pdu: CotpPdu) =>
		Uint8Array.from([
			...pdu.rawHeader.subarray(0, 6),
			...[...new Map(pdu.parameters.map((part) => [part.id, part])).values()]
				.filter((part) => part.id !== 0xc3)
				.sort((a, b) => a.id - b.id)
				.flatMap((part) => [part.id, part.raw.length, ...([8, 9].includes(part.id) ? [] : part.raw)]),
		]);
	const a = header(left),
		b = header(right),
		dataA = left.userData ?? new Uint8Array(),
		dataB = right.userData ?? new Uint8Array();
	return (
		a.length === b.length &&
		a.every((byte, index) => byte === b[index]) &&
		dataA.length === dataB.length &&
		dataA.every((byte, index) => byte === dataB[index])
	);
}
