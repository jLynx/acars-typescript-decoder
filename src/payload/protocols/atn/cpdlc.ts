import { readAtnCpdlcRoot } from './cpdlc-schema';
import type { AtnCpdlc, AtnCpdlcOptions } from './cpdlc.types';
import { annotateAtnMeasurements } from './cpdlc-measurements';

/** Explicit ATN profile/direction; protected payloads remain opaque until integrity verifies. */
export function decodeAtnCpdlc(bytes: Uint8Array, options: AtnCpdlcOptions): AtnCpdlc {
	if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 8192)
		throw new RangeError('ATN CPDLC requires 1–8192 bytes');
	if (!options || !['uplink', 'downlink'].includes(options.direction) || !['plain', 'protected'].includes(options.mode))
		throw new TypeError('ATN CPDLC direction/mode required');
	const bitLength = options.bitLength ?? bytes.length * 8;
	if (!Number.isInteger(bitLength) || bitLength <= (bytes.length - 1) * 8 || bitLength > bytes.length * 8)
		throw new RangeError('Invalid ATN CPDLC bit length');
	const type = `${options.mode === 'protected' ? 'Protected' : ''}${options.direction === 'uplink' ? 'Ground' : 'Aircraft'}PDUs`;
	const { value, bits } = readAtnCpdlcRoot(bytes, type);
	if (options.mode === 'plain') annotateAtnMeasurements(value);
	if (bits.position > bitLength) throw new Error('Truncated ATN CPDLC bit string');
	const structureComplete = bits.paddingOnly() && (bitLength === bytes.length * 8 || bits.position === bitLength);
	return {
		protocol: 'ATN-CPDLC',
		direction: options.direction,
		mode: options.mode,
		raw: bytes.slice(),
		bitLength,
		consumedBits: bits.position,
		structureComplete,
		integrity: 'unverified',
		value,
		notes: [
			'Explicit schema decoding does not establish association state or application integrity; named measurement scales refer to the pinned ASN.1 definitions.',
			...(options.mode === 'protected'
				? ['Protected CPDLC message bits remain opaque until aircraft/flight/facility-bound integrity can be verified.']
				: []),
			...(!structureComplete ? ['Unconsumed bytes or nonzero padding remain in raw.'] : []),
		],
		source: {
			repository: 'https://github.com/wireshark/wireshark',
			revision: 'ad85ea3cb5af4e9665f1b3e3cda5bee94b71ab73',
			files: ['epan/dissectors/asn1/atn-cpdlc/atn-cpdlc.asn'],
		},
	};
}
