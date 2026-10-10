// FANS constructed positions from the pinned MIT libacars ASN.1 member orders.
import type { Bits } from '@/payload/protocols/bits';
import { coordinate, degrees } from '@/payload/protocols/cpdlc-values';
import { distance } from './extended';

export function publishedIdentifier(bits: Bits): string {
	const coordinates = bits.read(1);
	const fix = bits.text(bits.constrained(3, 1, 5), true);
	return fix + (coordinates ? ` (${latitudeLongitude(bits)})` : '');
}

export function latitudeLongitude(bits: Bits): string {
	return `${coordinate(bits, true)}°, ${coordinate(bits, false)}°`;
}

export function placeBearing(bits: Bits): string {
	return `${publishedIdentifier(bits)} bearing ${degrees(bits)}`;
}

export function placeBearingDistance(bits: Bits): string {
	return `${placeBearing(bits)} / ${distance(bits)}`;
}

export function trackDetail(bits: Bits): string {
	const name = bits.text(bits.constrained(2, 3, 6), true);
	const count = bits.constrained(7, 1, 128);
	const points = Array.from({ length: count }, () => latitudeLongitude(bits));
	return `track ${name} · ${points.join(' > ')}`;
}
