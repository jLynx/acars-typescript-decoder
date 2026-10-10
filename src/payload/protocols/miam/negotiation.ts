// Common CORE v1/v2 ALO/ALR layout from MIT libacars miam-core.c.
import type { AcarsInterpretation } from '@/payload/types';

export function interpretNegotiation(header: Uint8Array, body: string): AcarsInterpretation | undefined {
	const version = header[0] & 15;
	const type = header[0] >> 4;
	if (![1, 2].includes(version) || ![2, 3].includes(type) || header.length !== 16 || body) return;
	const length = (header[1] << 16) | (header[2] << 8) | header[3];
	const aircraft = String.fromCharCode(...header.slice(4, 11));
	if (length !== 16 || !/^[. A-Z0-9-]{7}$/.test(aircraft) || !/[A-Z0-9]/.test(aircraft)) return;
	const compression = header[11];
	const networks = header[12];
	const unknown = unknownCapabilities(header);
	const name = type === 2 ? 'ALO' : 'ALR';
	return {
		title: `MIAM ${name} negotiation`,
		summary: `CORE v${version} · ${aircraft.trim()} · ${name} · ${networks & 1 ? 'ACARS' : ''}${networks === 3 ? ', ' : ''}${networks & 2 ? 'IP middleware' : ''}.`,
		coverage: unknown ? 'partial' : 'decoded',
		fields: [
			{ label: 'MIAM transfer', value: `Single transfer · CORE version ${version}` },
			{ label: 'Negotiation PDU', value: name },
			{ label: 'Aircraft identifier (raw)', value: aircraft },
			{
				label: type === 2 ? 'Supported compression' : 'Selected compression',
				value: compression & 1 ? 'Deflate' : 'None advertised',
			},
			{
				label: 'Supported networks',
				value:
					[networks & 1 ? 'ACARS' : '', networks & 2 ? 'IP middleware' : ''].filter(Boolean).join(', ') ||
					'None advertised',
			},
			{ label: 'Compression bitmask (raw)', value: String(compression) },
			{ label: 'Network bitmask (raw)', value: String(networks) },
		],
		notes: unknown ? ['Unknown capability bits remain raw.'] : [],
	};
}

function unknownCapabilities(header: Uint8Array): boolean {
	return Boolean(header[11] & ~1 || header[12] & ~3 || header.slice(13).some((byte) => byte !== 0));
}
