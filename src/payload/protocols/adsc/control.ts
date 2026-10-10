// Control field layouts/cause names adapted from MIT libacars adsc.c and datalink adsc.rs.
// Revisions and original notices are recorded in docs/upstreams.json and THIRD_PARTY_NOTICES.txt.
import type { Bits } from '@/payload/protocols/bits';
import type { AcarsField } from '@/payload/types';
import type { ApplicationDecode } from '@/payload/protocols/types';

const nackReasons = [
	'Unspecified',
	'Duplicate group tag',
	'Duplicate reporting interval tag',
	'Event contract request with no data',
	'Improper operational mode tag',
	'Cancel request of a contract which does not exist',
	'Requested contract already exists',
	'Undefined contract request tag',
	'Undefined error',
	'Not enough data in request',
	'Invalid altitude range: low limit >= high limit',
	'Vertical speed threshold is 0',
	'Aircraft intent projection time is 0',
	'Lateral deviation threshold is 0',
];

export function negativeAcknowledgement(bits: Bits): AcarsField[] {
	const contract = bits.read(8),
		reason = bits.read(8);
	if (reason > 13) throw new Error('Invalid ADS-C rejection reason');
	const extension = [1, 2, 7].includes(reason) ? bits.read(8) : undefined;
	return [
		{
			label: 'Rejected contract',
			value: `${contract} · reason code ${reason}${extension === undefined ? '' : ` · extension ${extension}`}`,
		},
		{ label: 'Contract rejection reason', value: nackReasons[reason] },
		...(extension === undefined
			? []
			: [{ label: reason === 7 ? 'Erroneous tag number' : 'Erroneous octet number', value: String(extension) }]),
	];
}

export function decodeAdscDisconnect(bytes: Uint8Array): ApplicationDecode {
	if (!(bytes instanceof Uint8Array) || bytes.length !== 1) throw new Error('ADS-C DIS requires one octet');
	const reason = bytes[0] >>> 4,
		reserved = bytes[0] & 15;
	const names: Record<number, string> = {
		0: 'Reason not specified',
		1: 'Congestion',
		2: 'Application not available',
		8: 'Normal disconnect',
	};
	return {
		fields: [
			{ label: 'Disconnect reason code', value: String(reason) },
			{ label: 'Disconnect reason', value: names[reason] ?? 'Unknown' },
			{ label: 'Disconnect octet (raw)', value: bytes[0].toString(16).padStart(2, '0').toUpperCase() },
			...(reserved ? [{ label: 'Disconnect low nibble (raw)', value: String(reserved) }] : []),
		],
		summary: `ADS-C disconnect request · ${names[reason] ?? `unknown reason ${reason}`}.`,
		complete: names[reason] !== undefined && !reserved,
		notes: reserved || !names[reason] ? ['Unknown reason or low-nibble data retained without interpretation.'] : [],
	};
}
