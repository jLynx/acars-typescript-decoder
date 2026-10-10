// FANS constraints and units from MIT libacars generated types and formatters.
import type { Bits } from '@/payload/protocols/bits';
import { altitude, position, degrees, direction } from '@/payload/protocols/cpdlc-values';

export function verticalRate(bits: Bits): string {
	return bits.read(1) ? `${bits.constrained(8, 0, 200) * 10} m/min` : `${bits.constrained(6, 0, 60) * 100} ft/min`;
}

export function remainingFuel(bits: Bits): string {
	return `${bits.constrained(5, 0, 23)} h ${bits.constrained(6, 0, 59)} min`;
}

export function remainingSouls(bits: Bits): string {
	return String(bits.constrained(10, 1, 1024));
}

export function toFrom(bits: Bits): string {
	return bits.read(1) ? 'from' : 'to';
}

export function distance(bits: Bits): string {
	return bits.read(1) ? `${bits.constrained(10, 1, 1024)} km` : `${bits.constrained(14, 0, 9999) / 10} NM`;
}

export function legType(bits: Bits): string {
	if (bits.read(1)) return `${bits.constrained(7, 1, 99) / 10} min legs`;
	return bits.read(1) ? `${bits.constrained(7, 1, 128)} km legs` : `${bits.constrained(10, 1, 999) / 10} NM legs`;
}

/** Holding leg type has a presence bit before the required fields, not at the end. */
export function holdClearance(bits: Bits): string {
	const leg = bits.read(1);
	const fix = position(bits);
	const level = altitude(bits);
	const track = degrees(bits);
	const turns = direction(bits);
	return `HOLD AT ${fix} MAINTAIN ${level} INBOUND TRACK ${track} ${turns} TURNS${leg ? ` ${legType(bits)}` : ''}`;
}
