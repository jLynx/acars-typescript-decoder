// Pinned dumpvdl2 CPDLCMessageSetVersion2BCVersion1/ADSMessageSetVersion2.
import schema from './schema.json';
import { readAtnCpdlcRoot } from '@/payload/protocols/atn/cpdlc-schema';
import type { AtnCpdlcDescriptor, AtnCpdlcValue } from '@/payload/protocols/atn/cpdlc.types';
import type { AtnB2Structure, AtnB2Options } from './types';

const definitions = schema.nodes as unknown as Record<string, AtnCpdlcDescriptor>;

function root(options: AtnB2Options): string {
	if (options.application === 'cpdlc')
		return options.mode === 'protected'
			? options.direction === 'uplink'
				? 'ProtectedGroundPDUs'
				: 'ProtectedAircraftPDUs'
			: options.direction === 'uplink'
				? 'ATCUplinkMessage'
				: 'ATCDownlinkMessage';
	if (options.mode === 'protected') return options.direction === 'uplink' ? 'ADSGroundPDUs' : 'ADSAircraftPDUs';
	const roots = {
		request: 'ADSRequestContract',
		report: 'ADSReport',
		accept: 'ADSAccept',
		reject: 'ADSReject',
		noncompliance: 'ADSNonCompliance',
		positiveAcknowledgement: 'ADSPositiveAcknowledgement',
	};
	if (
		!options.message ||
		!(options.message in roots) ||
		(options.direction === 'uplink') !== (options.message === 'request')
	)
		throw new TypeError('ADS-C v2 application message type and matching direction required');
	return roots[options.message];
}

function hasExtensions(value: AtnCpdlcValue): boolean {
	return Boolean(
		value.extensions?.some((extension) => !extension.value || hasExtensions(extension.value)) ||
		value.children?.some(hasExtensions),
	);
}

function validate(bytes: Uint8Array, options: AtnB2Options): number {
	if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 8192)
		throw new RangeError('ATN B2 requires 1–8192 bytes');
	if (
		!options ||
		!['uplink', 'downlink'].includes(options.direction) ||
		!['cpdlc', 'adsc'].includes(options.application) ||
		!['application', 'protected'].includes(options.mode)
	)
		throw new TypeError('ATN B2 application/mode/direction required');
	if (options.message && (options.application !== 'adsc' || options.mode !== 'application'))
		throw new TypeError('ADS-C inner message type applies only to ADS-C application mode');
	const bitLength = options.bitLength ?? bytes.length * 8;
	if (!Number.isInteger(bitLength) || bitLength <= (bytes.length - 1) * 8 || bitLength > bytes.length * 8)
		throw new RangeError('Invalid ATN B2 bit length');
	return bitLength;
}

/** Explicit B2 schema input; protected application bytes remain opaque. */
export function decodeAtnB2Structure(bytes: Uint8Array, options: AtnB2Options): AtnB2Structure {
	const bitLength = validate(bytes, options);
	const { value, bits } = readAtnCpdlcRoot(bytes, root(options), definitions);
	if (bits.position > bitLength) throw new Error('Truncated ATN B2 bit string');
	const structureComplete = bits.paddingOnly() && (bitLength === bytes.length * 8 || bits.position === bitLength);
	return {
		protocol: options.application === 'cpdlc' ? 'ATN-B2-CPDLC' : 'ATN-ADSC-V2',
		direction: options.direction,
		mode: options.mode,
		...(options.message ? { message: options.message } : {}),
		raw: bytes.slice(),
		bitLength,
		consumedBits: bits.position,
		structureComplete,
		value,
		integrity: 'unverified',
		notes: [
			'Explicit schema input retains constrained wire values; complete semantic/application integrity coverage is not established.',
			...(options.mode === 'protected'
				? ['Protected application message bytes remain opaque pending context-bound integrity verification.']
				: []),
			...(!structureComplete ? ['Unconsumed bytes or nonzero padding remain in raw.'] : []),
			...(hasExtensions(value) ? ['Unsupported extension open types remain raw.'] : []),
		],
		source: { repository: 'https://github.com/szpajder/dumpvdl2', revision: schema.revision, files: ['src/asn1/*.c'] },
	};
}
