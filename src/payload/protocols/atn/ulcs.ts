// ICAO Doc 9705 Ed2 envelope layouts adapted from Wireshark, GPL-2.0-or-later.
import { Bits } from '@/payload/protocols/bits';
import type { AtnUlcs, AtnPresentationValue } from './types';
import { perInteger, perLength, perOid, perPayload } from './per';
import { decodeAtnAcse } from './acse';

const sessions: Record<number, NonNullable<AtnUlcs['session']>['type']> = {
	0xe8: 'SCN',
	0xf8: 'SCNC',
	0xf0: 'SAC',
	0xd8: 'SACC',
	0xe0: 'SRF',
	0xa0: 'SRFC',
};
const rejectReasons = [
	'Presentation-user',
	'Reason not specified (transient)',
	'Temporary congestion (transient)',
	'Local limit exceeded (transient)',
	'Called presentation-address unknown (permanent)',
	'Protocol version not supported (permanent)',
	'Default context not supported (permanent)',
	'User data not readable (permanent)',
];

function value(bits: Bits): AtnPresentationValue {
	const syntaxPresent = bits.read(1);
	const transferSyntax = syntaxPresent ? perOid(bits) : undefined;
	const extended = bits.read(1);
	const contextIdentifier = extended ? perInteger(bits) : bits.constrained(7, 1, 127);
	if (extended && contextIdentifier < 128) throw new Error('Invalid extended presentation context');
	const encoding = bits.constrained(2, 0, 2);
	return {
		contextIdentifier,
		context:
			({ 1: 'acse-apdu', 2: 'reserved', 3: 'user-ase-apdu' } as const)[contextIdentifier as 1 | 2 | 3] ?? 'unknown',
		...(transferSyntax ? { transferSyntax } : {}),
		encoding: (['single-ASN1-type', 'octet-aligned', 'arbitrary'] as const)[encoding],
		...perPayload(bits, encoding === 2 ? 1 : 8),
		profileSupported: !syntaxPresent && !extended && [1, 3].includes(contextIdentifier) && encoding === 2,
	};
}

function data(bytes: Uint8Array, result: AtnUlcs): void {
	// Fully-encoded-data is SIZE (1, ..., 2..MAX), not an additional 0x00 header.
	const bits = new Bits(bytes);
	const extended = bits.read(1);
	let count = 1;
	if (extended) {
		const length = perLength(bits);
		if (length.fragmented || length.length < 2 || length.length > 16)
			throw new Error('Unsupported presentation list length');
		count = length.length;
	}
	for (let i = 0; i < count; i++) result.values.push(value(bits));
	result.envelopeComplete = bits.paddingOnly();
	if (!result.envelopeComplete) result.notes.push('Nonzero padding or trailing bytes are retained in raw.');
	if (extended || result.values.some((item) => !item.profileSupported))
		result.notes.push(
			'An excluded or extended ULCS profile field is retained; its application context is not inferred.',
		);
}

function connection(bytes: Uint8Array, result: AtnUlcs): void {
	if (bytes.length < 2) throw new Error('Truncated short session/presentation header');
	const raw = bytes[0];
	const type = sessions[raw & 0xf8];
	if (!type) throw new Error('Unsupported short session type');
	const refusal = type === 'SRF' || type === 'SRFC';
	result.session = {
		type,
		raw,
		...(refusal
			? {
					parameterIndication: Boolean(raw & 4),
					...(raw & 4 ? { transportReleased: Boolean(raw & 2), persistent: Boolean(raw & 1) } : {}),
				}
			: {}),
	};
	const presentation = bytes[1];
	const presentationType = refusal ? 'CPR' : type === 'SCN' || type === 'SCNC' ? 'CP' : 'CPA';
	const code = (presentation >> 4) & 7;
	result.presentation = {
		type: presentationType,
		raw: presentation,
		...(refusal ? { error: { code, description: rejectReasons[code] } } : {}),
	};
	const validSession = refusal ? Boolean(raw & 4) || (raw & 3) === 0 : (raw & 7) === 0;
	const validPresentation = refusal ? (presentation & 0x8f) === 2 : presentation === 2;
	result.envelopeComplete = validSession && validPresentation;
	result.application = bytes.slice(2);
	if (!result.envelopeComplete) result.notes.push('Unsupported short-header flags are retained as received.');
	result.notes.push(
		'ACSE application bytes are retained; application schemas, protected integrity and association state remain unverified.',
	);
}

/** Decode explicitly identified ATN user data from a complete COTP assembly. */
export function decodeAtnUlcs(bytes: Uint8Array, mode: 'data' | 'connection'): AtnUlcs {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 8192)
		throw new RangeError('ATN ULCS requires 1–8192 bytes');
	if (mode !== 'data' && mode !== 'connection') throw new TypeError('ATN ULCS mode must be data or connection');
	const result: AtnUlcs = {
		protocol: 'ATN-ULCS',
		mode,
		raw: bytes.slice(),
		coverage: 'partial',
		integrity: 'unverified',
		envelopeComplete: false,
		values: [],
		notes: ['Session/presentation structure does not establish application validity or integrity.'],
		source: {
			repository: 'https://github.com/wireshark/wireshark',
			revision: 'ad85ea3cb5af4e9665f1b3e3cda5bee94b71ab73',
			files: ['epan/dissectors/asn1/atn-ulcs/atn-ulcs.asn', 'epan/dissectors/asn1/atn-ulcs/packet-atn-ulcs-template.c'],
		},
	};
	if (mode === 'data') data(bytes, result);
	else connection(bytes, result);
	const candidates =
		mode === 'connection'
			? []
			: result.values.filter((item) => item.contextIdentifier === 1 && item.encoding === 'arbitrary');
	for (const candidate of candidates) {
		try {
			candidate.acse = decodeAtnAcse(candidate.payload, candidate.bitLength);
		} catch {
			result.notes.push('ACSE context contains a malformed or unsupported APDU; original presentation bytes retained.');
		}
	}
	if (result.application?.length) {
		try {
			result.acse = decodeAtnAcse(result.application);
		} catch {
			result.notes.push('Connection ACSE APDU is malformed or unsupported; original application bytes retained.');
		}
	}
	return result;
}
