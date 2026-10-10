// Named performance/frequency wire fields adapted from MIT datalink hfdl.rs.
import type { HfdlRateCounts, HfdlReport } from './types';

const word = (bytes: Uint8Array, offset: number) => bytes[offset] + bytes[offset + 1] * 256;
const coordinate = (value: number) => ((value >= 0x80000 ? value - 0x100000 : value) * 180) / 0x7ffff;

export function decodeHfdlReport(bytes: Uint8Array): HfdlReport | undefined {
	if (bytes.length < 15 || ![0xd1, 0xd5].includes(bytes[1])) return;
	const flightBytes = bytes.subarray(2, 8);
	if (!flightBytes.every((byte) => byte === 0 || (byte >= 32 && byte <= 126))) return;
	const latitude = coordinate(bytes[8] + bytes[9] * 256 + (bytes[10] & 15) * 65536);
	const longitude = coordinate((bytes[10] >>> 4) + bytes[11] * 16 + bytes[12] * 4096);
	const time = word(bytes, 13) * 2;
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || time >= 86400) return;
	const result: HfdlReport = {
		flight: String.fromCharCode(...flightBytes).replace(/^[\0 ]+|[\0 ]+$/g, ''),
		position: { latitude, longitude, unit: 'deg' },
		time,
		timeUnit: 's',
		unconsumed: new Uint8Array(),
	};
	if (bytes[1] === 0xd1) {
		if (bytes.length < 47) return;
		result.performance = performance(bytes);
		result.unconsumed = bytes.slice(47);
	} else {
		if ((bytes.length - 15) % 6 || bytes.length > 51) return;
		result.frequencies = Array.from({ length: (bytes.length - 15) / 6 }, (_, index) => {
			const offset = 15 + index * 6;
			return {
				groundStation: bytes[offset] & 127,
				propagatingMask: bytes[offset + 1] + bytes[offset + 2] * 256 + (bytes[offset + 3] & 15) * 65536,
				heardMask: (bytes[offset + 3] >>> 4) + bytes[offset + 4] * 16 + bytes[offset + 5] * 4096,
			};
		});
	}
	return result;
}

function counts(bytes: Uint8Array, offset: number): HfdlRateCounts {
	return { 300: bytes[offset + 3], 600: bytes[offset + 2], 1200: bytes[offset + 1], 1800: bytes[offset] };
}

function performance(bytes: Uint8Array): NonNullable<HfdlReport['performance']> {
	const change = bytes[46] & 15;
	return {
		version: bytes[15],
		flightLeg: bytes[16],
		groundStation: bytes[17] & 127,
		frequencyId: bytes[18],
		frequencySearches: { previousLeg: word(bytes, 19), currentLeg: word(bytes, 21) },
		hfDisabled: { previousLeg: word(bytes, 23), currentLeg: word(bytes, 25), unit: 's' },
		mpdusReceived: counts(bytes, 27),
		mpdusWithErrors: counts(bytes, 31),
		spdusReceived: word(bytes, 35),
		spdusMissed: bytes[37],
		mpdusTransmitted: counts(bytes, 38),
		mpdusDelivered: counts(bytes, 42),
		frequencyChange: change,
		frequencyChangeName:
			[
				'First frequency search in this flight leg',
				'Too many NACKs',
				'SPDUs no longer received',
				'HFDL disabled',
				'Ground station frequency change',
				'Ground station down / channel down',
				'Poor uplink channel quality',
				'No change',
			][change] ?? 'Unknown',
	};
}
