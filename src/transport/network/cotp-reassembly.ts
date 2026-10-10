// Independent, passive class-4 DT reassembly from RFC 905 §§6.10, 12.2.3.5, 13.7.
import { decodeCotp } from './cotp';
import { cotpInputLimit } from './cotp-size';
import { atnProfile } from './atn/profile';
import { cotpDeadlineStart, cotpRetainedBytes, newCotpChain, processCotpService } from './cotp-service';
import type {
	CotpChain,
	CotpConnection,
	CotpReassembler,
	CotpReassemblyOptions,
	CotpReception,
	CotpResult,
} from './types';

function limit(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		throw new RangeError('Invalid COTP reassembly limit');
	return result;
}

/** Caller establishes connection/format and a known message boundary. No active acknowledgements or negotiation. */
export function createCotpReassembler(options: CotpReassemblyOptions = {}): CotpReassembler {
	const maxNsduBytes = cotpInputLimit(options.maxNsduBytes);
	const limits = {
		maxBytes: limit(options.maxBytes, 65536, 65536),
		maxFragments: limit(options.maxFragments, 128, 1024),
		windowSize: limit(options.windowSize, 32, 63),
	};
	const maxConnections = limit(options.maxConnections, 64, 256);
	const retentionMs = limit(options.retentionMs, 60_000, 3_600_000);
	const chains = new Map<string, CotpChain>();
	let watermark = -Infinity;
	const expire = (receivedAt: number): string[] => {
		watermark = Math.max(watermark, receivedAt);
		const discarded = [...chains]
			.filter(([, chain]) => watermark - cotpDeadlineStart(chain) >= retentionMs)
			.map(([id]) => id);
		for (const id of discarded) chains.delete(id);
		return discarded;
	};
	return {
		open(connection, receivedAt) {
			validateConnection(connection);
			validateReception({ link: connection.link, receivedAt });
			const discarded = expire(receivedAt);
			if (watermark - receivedAt >= retentionMs) throw new RangeError('Stale COTP connection boundary');
			const key = connectionKey(connection.link, connection.destinationReference);
			chains.delete(key);
			if (chains.size >= maxConnections) {
				const oldest = chains.keys().next().value!;
				chains.delete(oldest);
				discarded.push(oldest);
			}
			chains.set(key, newCotpChain(connection, receivedAt));
			return discarded;
		},
		push(bytes, reception) {
			validateReception(reception);
			if (!(bytes instanceof Uint8Array) || bytes.length < 2 || bytes.length > maxNsduBytes)
				throw new TypeError('Invalid COTP NSDU');
			const discarded = expire(reception.receivedAt);
			const parsed = parseNegotiated(bytes, reception.link, chains, maxNsduBytes);
			if (
				parsed.integrity !== 'verified' ||
				parsed.unconsumed.length ||
				parsed.pdus.some((pdu) => {
					const chain = chains.get(connectionKey(reception.link, pdu.destinationReference));
					return (
						(pdu.atnIntegrity !== undefined && pdu.atnIntegrity !== 'verified') ||
						atnProfile(pdu) !== chain?.atnChecksum
					);
				})
			) {
				return {
					packet: parsed,
					discarded,
					assemblies: [
						{
							status: 'failed',
							destinationReference: 0,
							fragments: 0,
							reason: 'NSDU is malformed or not every TPDU checksum verifies.',
						},
					],
				};
			}
			const assemblies = parsed.pdus.flatMap((pdu) => {
				const key = connectionKey(reception.link, pdu.destinationReference);
				const chain = chains.get(key);
				const ignored = { status: 'ignored' as const, destinationReference: pdu.destinationReference, fragments: 0 };
				if (!chain) return [{ ...ignored, reason: 'No known connection/message boundary; open the connection first.' }];
				const results = processCotpService(chain, pdu, reception.receivedAt, limits);
				if (results.some((result) => result.status === 'closed')) {
					chains.delete(key);
					discarded.push(key);
				}
				return results;
			});
			return { packet: parsed, discarded, assemblies };
		},
		reset(link, destinationReference) {
			for (const [key, chain] of chains)
				if (
					(link === undefined || chain.link === link) &&
					(destinationReference === undefined || key === connectionKey(chain.link, destinationReference))
				)
					chains.delete(key);
		},
		stats() {
			return {
				connections: chains.size,
				bytes: [...chains.values()].reduce((sum, chain) => sum + cotpRetainedBytes(chain), 0),
			};
		},
	};
}

function connectionKey(link: string, reference: number): string {
	return JSON.stringify([link, reference]);
}

function validateReception(reception: CotpReception): void {
	if (
		typeof reception.link !== 'string' ||
		!reception.link ||
		reception.link.length > 240 ||
		reception.link.includes('\0')
	)
		throw new TypeError('Invalid COTP link identity');
	if (!Number.isFinite(reception.receivedAt)) throw new TypeError('Invalid COTP reception time');
}

function validateConnection(connection: CotpConnection): void {
	if (
		!Number.isInteger(connection.destinationReference) ||
		connection.destinationReference < 1 ||
		connection.destinationReference > 65535
	)
		throw new RangeError('Invalid COTP destination reference');
	if (!['normal', 'extended'].includes(connection.format)) throw new TypeError('Invalid COTP negotiated format');
	const sequence = connection.startSequence ?? 0;
	if (!Number.isInteger(sequence) || sequence < 0 || sequence >= (connection.format === 'normal' ? 128 : 2 ** 31))
		throw new RangeError('Invalid COTP starting sequence');
	if (
		connection.sourceReference !== undefined &&
		(!Number.isInteger(connection.sourceReference) ||
			connection.sourceReference < 1 ||
			connection.sourceReference > 65535)
	)
		throw new RangeError('Invalid COTP peer reference');
	validateExpedited(connection);
	if (connection.atnChecksum !== undefined && ![16, 32].includes(connection.atnChecksum))
		throw new RangeError('Invalid ATN checksum profile');
	if (connection.atnChecksum && !connection.atnAddresses) throw new TypeError('ATN profile requires NSAP addresses');
}

function validateExpedited(connection: CotpConnection): void {
	if (connection.expedited === undefined) return;
	if (!connection.expedited || typeof connection.expedited !== 'object')
		throw new TypeError('Invalid COTP expedited options');
	const start = connection.expedited.startSequence ?? 0;
	if (!Number.isInteger(start) || start < 0 || start >= (connection.format === 'normal' ? 128 : 2 ** 31))
		throw new RangeError('Invalid COTP expedited starting sequence');
}

function parseNegotiated(
	bytes: Uint8Array,
	link: string,
	chains: Map<string, CotpChain>,
	maxNsduBytes: number,
): CotpResult {
	const result: CotpResult = {
		protocol: 'COTP',
		raw: bytes.slice(),
		pdus: [],
		unconsumed: new Uint8Array(),
		coverage: 'headers',
		integrity: 'unverified',
	};
	let offset = 0;
	while (offset < bytes.length && result.pdus.length < 128) {
		const length = bytes[offset];
		if (length < 3 || length === 255 || offset + 1 + length > bytes.length) break;
		const reference = bytes[offset + 2] * 256 + bytes[offset + 3];
		const chain = chains.get(connectionKey(link, reference));
		const high = bytes[offset + 1] & 0xf0;
		const carriesData = [0xe0, 0xd0, 0x80, 0xf0, 0x10].includes(high);
		const end = carriesData ? bytes.length : offset + 1 + length;
		const parsed = decodeCotp(bytes.subarray(offset, end), {
			format: chain?.format,
			maxNsduBytes,
			atnAddresses: chain?.atnAddresses,
		});
		if (!parsed?.pdus.length || parsed.unconsumed.length) break;
		result.pdus.push(...parsed.pdus);
		if (parsed.coverage === 'partial') result.coverage = 'partial';
		offset = end;
	}
	result.unconsumed = bytes.slice(offset);
	if (result.unconsumed.length) result.coverage = 'partial';
	result.integrity = result.pdus.some((pdu) => pdu.integrity === 'failed')
		? 'failed'
		: result.pdus.length && !result.unconsumed.length && result.pdus.every((pdu) => pdu.integrity === 'verified')
			? 'verified'
			: 'unverified';
	return result;
}
