import type { Bits } from '@/payload/protocols/bits';
import { procedure } from '@/payload/protocols/cpdlc-values';
import { publishedIdentifier, latitudeLongitude, placeBearing, placeBearingDistance, trackDetail } from './places';
import { additionalRoute } from './additional';

/** FANS route clearance sequence: ten presence bits, followed by fields in schema order. */
export function routeClearance(bits: Bits): string {
	const present = Array.from({ length: 10 }, () => bits.read(1));
	const parts: string[] = [];
	if (present[0]) parts.push(`departure ${bits.text(4, true)}`);
	if (present[1]) parts.push(`destination ${bits.text(4, true)}`);
	if (present[2]) parts.push(`departure runway ${runway(bits)}`);
	if (present[3]) parts.push(procedure(bits));
	if (present[4]) parts.push(`arrival runway ${runway(bits)}`);
	if (present[5]) parts.push(procedure(bits));
	if (present[6]) parts.push(procedure(bits));
	if (present[7]) parts.push(`intercept ${bits.text(bits.constrained(3, 1, 5), true)}`);
	if (present[8]) {
		const count = bits.read(7) + 1;
		for (let i = 0; i < count; i++) parts.push(routeInformation(bits));
	}
	if (present[9]) parts.push(additionalRoute(bits));
	return parts.join(' · ') || 'No optional route fields';
}

function runway(bits: Bits): string {
	const number = bits.constrained(6, 1, 36);
	return `${String(number).padStart(2, '0')}${['L', 'R', 'C', ''][bits.read(2)]}`;
}

function routeInformation(bits: Bits): string {
	const choice = bits.constrained(3, 0, 5);
	if (choice === 0) return publishedIdentifier(bits);
	if (choice === 1) return latitudeLongitude(bits);
	if (choice === 2) return `${placeBearing(bits)} / ${placeBearing(bits)}`;
	if (choice === 3) return placeBearingDistance(bits);
	if (choice === 4) return `airway ${bits.text(bits.constrained(3, 1, 5), true)}`;
	return trackDetail(bits);
}

export function errorInformation(bits: Bits): string {
	const names = [
		'Application error',
		'Duplicate message identification number',
		'Unrecognized message reference number',
		'End service with pending messages',
		'End service with no valid response',
		'Insufficient message storage capacity',
		'No available message identification number',
		'Commanded termination',
		'Insufficient data',
		'Unexpected data',
		'Invalid data',
		'Reserved error 1',
		'Reserved error 2',
		'Reserved error 3',
		'Reserved error 4',
		'Reserved error 5',
		'Reserved error 6',
	];
	return names[bits.constrained(5, 0, 16)];
}
