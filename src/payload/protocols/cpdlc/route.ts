import type { Bits } from '@/payload/protocols/bits';
import { coordinate, procedure } from '@/payload/protocols/cpdlc-values';

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
	if (present[7]) parts.push(`intercept ${bits.text(bits.read(3) + 1, true)}`);
	if (present[8]) {
		const count = bits.read(7) + 1;
		for (let i = 0; i < count; i++) parts.push(routeInformation(bits));
	}
	if (present[9]) throw new Error('Additional route information is unsupported');
	return parts.join(' · ') || 'No optional route fields';
}

function runway(bits: Bits): string {
	const number = bits.constrained(6, 1, 36);
	return `${String(number).padStart(2, '0')}${['L', 'R', 'C', ''][bits.read(2)]}`;
}

function routeInformation(bits: Bits): string {
	const choice = bits.read(3);
	if (choice === 0) {
		const coordinates = bits.read(1);
		const fix = bits.text(bits.read(3) + 1, true);
		return fix + (coordinates ? ` (${coordinate(bits, true)}°, ${coordinate(bits, false)}°)` : '');
	}
	if (choice === 1) return `${coordinate(bits, true)}°, ${coordinate(bits, false)}°`;
	if (choice === 4 || choice === 5) return `${choice === 4 ? 'airway' : 'track'} ${bits.text(bits.read(3) + 1, true)}`;
	// Unsupported choices have their own body; never assume they consume no bits.
	throw new Error(`Unsupported route information choice ${choice}`);
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
