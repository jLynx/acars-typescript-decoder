// Additional route member order, constraints and units from MIT libacars FANS ASN.1.
import type { Bits } from '@/payload/protocols/bits';
import { altitude, position, speed, degrees, direction, time } from '@/payload/protocols/cpdlc-values';
import { distance, legType } from './extended';
import { publishedIdentifier, latitudeLongitude, placeBearing, placeBearingDistance } from './places';

const list = (bits: Bits, width: number, reader: (bits: Bits) => string): string[] =>
	Array.from({ length: bits.read(width) + 1 }, () => reader(bits));

export function additionalRoute(bits: Bits): string {
	const present = Array.from({ length: 6 }, () => bits.read(1));
	const parts: string[] = [];
	if (present[0]) parts.push(...list(bits, 3, alongTrack));
	if (present[1]) parts.push(reportingPoints(bits));
	if (present[2]) parts.push(...list(bits, 2, intercept));
	if (present[3]) parts.push(...list(bits, 3, holding));
	if (present[4]) parts.push(...list(bits, 5, waypoint));
	if (present[5]) parts.push(...list(bits, 5, arrival));
	return parts.join(' · ') || 'No additional route fields';
}

function atwAltitude(bits: Bits): string {
	const tolerance = ['at', 'at or above', 'at or below'][bits.constrained(2, 0, 2)];
	return `${tolerance} ${altitude(bits)}`;
}

function waypoint(bits: Bits): string {
	const hasSpeed = bits.read(1),
		hasAltitudes = bits.read(1);
	const fix = position(bits);
	const parameters = [fix];
	if (hasSpeed) parameters.push(speed(bits));
	if (hasAltitudes) parameters.push(...list(bits, 1, atwAltitude));
	return `waypoint ${parameters.join(' · ')}`;
}

function alongTrack(bits: Bits): string {
	const hasSpeed = bits.read(1),
		hasAltitudes = bits.read(1);
	const fix = position(bits);
	const sign = bits.read(1) ? '-' : '+';
	const parameters = [`along track ${fix} ${sign}${distance(bits)}`];
	if (hasSpeed) parameters.push(speed(bits));
	if (hasAltitudes) parameters.push(...list(bits, 1, atwAltitude));
	return parameters.join(' · ');
}

function reportingPoints(bits: Bits): string {
	const hasIncrement = bits.read(1),
		longitude = bits.read(1),
		negative = bits.read(1);
	const value = bits.constrained(longitude ? 8 : 7, 0, longitude ? 180 : 90);
	const hemisphere = longitude ? (negative ? 'W' : 'E') : negative ? 'S' : 'N';
	return `report at ${value}°${hemisphere}${hasIncrement ? ` every ${bits.constrained(5, 1, 20)}°` : ''}`;
}

function intercept(bits: Bits): string {
	const choice = bits.read(2);
	const fix =
		choice === 0
			? publishedIdentifier(bits)
			: choice === 1
				? latitudeLongitude(bits)
				: choice === 2
					? `${placeBearing(bits)} / ${placeBearing(bits)}`
					: placeBearingDistance(bits);
	return `intercept from ${fix} course ${degrees(bits)}`;
}

function holding(bits: Bits): string {
	const present = Array.from({ length: 7 }, () => bits.read(1));
	const parts = [`hold at ${position(bits)}`];
	if (present[0]) parts.push(`low speed ${speed(bits)}`);
	if (present[1]) parts.push(atwAltitude(bits));
	if (present[2]) parts.push(`high speed ${speed(bits)}`);
	if (present[3]) parts.push(`${direction(bits)} turns`);
	if (present[4]) parts.push(`inbound ${degrees(bits)}`);
	if (present[5]) parts.push(`expect further clearance ${time(bits)}`);
	if (present[6]) parts.push(legType(bits));
	return parts.join(' · ');
}

function arrival(bits: Bits): string {
	const hasTolerance = bits.read(1);
	const fix = position(bits),
		clock = time(bits);
	const tolerance = ['at', 'at or after', 'at or before'][bits.constrained(2, 0, 2)];
	// libacars formats RTA tolerance as tenths of minutes.
	return `required arrival ${fix} ${tolerance} ${clock}${hasTolerance ? ` tolerance ${bits.constrained(8, 1, 150) / 10} min` : ''}`;
}
