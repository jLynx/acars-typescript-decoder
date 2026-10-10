// FANSPredepartureClearance optional bitmap and members from MIT libacars.
import type { Bits } from '@/payload/protocols/bits';
import { altitude, beacon, time } from '@/payload/protocols/cpdlc-values';
import { routeClearance } from './route';

const equipment = [
	'LORAN A',
	'LORAN C',
	'DME',
	'DECCA',
	'ADF',
	'GNSS',
	'HF RTF',
	'Inertial navigation',
	'ILS',
	'OMEGA',
	'VOR',
	'Doppler',
	'RNAV route equipment',
	'TACAN',
	'UHF RTF',
	'VHF RTF',
];
const surveillance = [
	'None',
	'Mode A',
	'Modes A and C',
	'Mode S',
	'Mode S pressure altitude',
	'Mode S aircraft identification',
	'Mode S pressure altitude and identification',
];

function aircraftEquipment(bits: Bits): string {
	const list = bits.read(1);
	const available = bits.read(1);
	const status = list ? Array.from({ length: bits.constrained(4, 1, 16) }, () => equipment[bits.read(4)]) : [];
	const ssr = surveillance[bits.constrained(3, 0, 6)];
	return `COMM/NAV/approach equipment ${available ? 'available' : 'unavailable'}${status.length ? ` (${status.join(', ')})` : ''}; SSR ${ssr}`;
}

export function predepartureClearance(bits: Bits): string {
	const type = bits.read(1),
		equipmentPresent = bits.read(1),
		restriction = bits.read(1);
	const flight = bits.text(bits.constrained(3, 2, 7), true);
	const parts = [`PREDEPARTURE CLEARANCE ${flight}`];
	if (type) parts.push(`aircraft ${bits.text(bits.constrained(2, 2, 5), true)}`);
	if (equipmentPresent) parts.push(aircraftEquipment(bits));
	parts.push(`EDCT ${time(bits)}`, routeClearance(bits));
	if (restriction) parts.push(`altitude restriction ${altitude(bits)}`);
	parts.push(
		`departure frequency ${(bits.constrained(15, 117000, 138000) / 1000).toFixed(3)} MHz`,
		`squawk ${beacon(bits)}`,
		`revision ${bits.constrained(4, 1, 16)}`,
	);
	return parts.join(' · ');
}
