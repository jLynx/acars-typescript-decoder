// X.25/CLNP/IDRP layouts adapted from MIT xoolive/datalink x25.rs.
import { decodeCotp } from './cotp';
import { decodeClnp } from './clnp';
import { decodeIdrp } from './idrp';
import { decodeEsis } from './esis';
export { decodeIdrp } from './idrp';
import type { ClnpCompressed, CotpOptions, X25Packet } from './types';

const word = (bytes: Uint8Array, offset: number) => bytes[offset] * 256 + bytes[offset + 1];

/** Modulo-8 X.25 packet bytes, excluding the link envelope/FCS. Fragmented data remains raw. */
export function decodeX25(bytes: Uint8Array, options: CotpOptions = {}): X25Packet | undefined {
	if (!(bytes instanceof Uint8Array) || bytes.length < 3 || bytes.length > 8192 || ((bytes[0] >>> 4) & 3) !== 1) return;
	const code = bytes[2];
	const type = !(code & 1) ? 'Data' : code & 31;
	const result: X25Packet = {
		protocol: 'X.25',
		type:
			type === 'Data'
				? type
				: type === 1
					? 'Receive Ready'
					: type === 5
						? 'Receive Not Ready'
						: type === 9
							? 'Receive Reject'
							: 'Unknown',
		channelGroup: bytes[0] & 15,
		channel: bytes[1],
		qualifier: Boolean(bytes[0] & 128),
		deliveryConfirmation: Boolean(bytes[0] & 64),
		raw: bytes.slice(),
		payload: bytes.slice(3),
	};
	if (result.type === 'Data') {
		result.sendSequence = (code >>> 1) & 7;
		result.receiveSequence = code >>> 5;
		result.more = Boolean(code & 16);
		if (!result.more) {
			if (result.payload[0] === 0x81) result.network = decodeClnp(result.payload, options);
			else if (result.payload[0] === 0x82) result.esis = decodeEsis(result.payload);
			else result.clnp = decodeClnpCompressed(result.payload, options);
		}
	} else if (result.type !== 'Unknown') result.receiveSequence = code >>> 5;
	return result;
}

/** Compressed CLNP headers. Derived fragments are retained without inner application decoding. */
export function decodeClnpCompressed(bytes: Uint8Array, options: CotpOptions = {}): ClnpCompressed | undefined {
	if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > 8192) return;
	const type = bytes[0] >>> 4;
	if (![0, 1, 2, 3, 6, 7, 9, 10].includes(type)) return;
	let position = 4;
	let localReference = bytes[3] & 127;
	if (bytes[3] & 128) {
		if (position >= bytes.length) return;
		localReference = localReference * 256 + bytes[position++];
	}
	const result: ClnpCompressed = {
		protocol: 'CLNP compressed',
		type,
		priority: bytes[0] & 15,
		flags: bytes[2],
		lifetime: bytes[1] / 2,
		lifetimeUnit: 's',
		localReference,
		raw: bytes.slice(),
		payload: new Uint8Array(),
	};
	const derived = [6, 7, 9, 10].includes(type);
	result.derived = derived;
	result.more = [7, 10].includes(type);
	if ([1, 3].includes(type) || derived) {
		if (position + 2 > bytes.length) return;
		result.pduId = word(bytes, position);
		position += 2;
	}
	if (derived) {
		if (position + 4 > bytes.length) return;
		result.offset = word(bytes, position);
		result.totalLength = word(bytes, position + 2);
		position += 4;
	}
	result.payload = bytes.slice(position);
	if (derived && !validDerived(result)) return;
	if (!derived && result.payload.length) {
		if (result.payload[0] === 0x85) result.idrp = decodeIdrp(result.payload);
		else {
			const cotp = decodeCotp(result.payload, options);
			if (cotp?.pdus.length) result.cotp = cotp;
		}
	}
	return result;
}

function validDerived(result: ClnpCompressed): boolean {
	return Boolean(
		result.payload.length && result.totalLength && result.offset! + result.payload.length <= result.totalLength,
	);
}
