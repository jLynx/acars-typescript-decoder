// SPDX-License-Identifier: GPL-3.0-or-later
// Parameter catalogue/field layouts adapted from dumpvdl2 xid.c; Copyright 2017–2026 Tomasz Lemiech.
import type { XidParameter } from '@/transport/types';
import { decodeAvlcAddress } from '@/transport/address';

const publicNames: Record<number, string> = {
	5: 'N1 downlink (raw)',
	6: 'N1 uplink (raw)',
	7: 'Window downlink (raw)',
	8: 'Window uplink (raw)',
	9: 'T1 downlink (raw)',
	10: 'N2 counter (raw)',
	11: 'T2 timer (raw)',
};
const privateNames: Record<number, string> = {
	2: 'Signal quality (raw)',
	3: 'XID sequencing',
	5: 'Expedited subnetwork connection (raw)',
	6: 'Link connection refusal',
	0x81: 'Modulation support',
	0x82: 'Alternate ground stations',
	0x40: 'Autotune frequency',
	0x41: 'Replacement ground stations',
	0x43: 'MAC persistence (raw)',
	0x44: 'M1 counter (raw)',
	0x45: 'TM2 timer (raw)',
	0x46: 'TG5 timer (raw)',
	0x47: 'T3 minimum timer (raw)',
	0x48: 'Ground station address filter',
	0x49: 'Broadcast connection (raw)',
	0xc3: 'Nearest airport',
	0xc6: 'TG3 timer (raw)',
	0xc7: 'TG4 timer (raw)',
};

export function additionalXidParameter(group: number, result: XidParameter): void {
	const { id } = result;
	result.name = (group === 0x80 ? publicNames : group === 0xf0 ? privateNames : {})[id] ?? result.name;
	if (group !== 0xf0) return;
	decodeManagement(result);
	decodeStationParameters(result);
}

function decodeManagement(result: XidParameter): void {
	const { id, raw } = result;
	if (id === 1 && raw.length === 1) result.value = raw[0];
	if (id === 3 && raw.length === 1) result.sequencing = { sequence: raw[0] & 7, retry: raw[0] >>> 4 };
	if (id === 6 && raw.length >= 3)
		result.refusal = { cause: raw[0], delayRaw: raw[1] * 256 + raw[2], additional: raw.slice(3) };
	if (id === 0x81 && raw.length === 1)
		result.modulations = {
			mask: raw[0],
			vdl2: Boolean(raw[0] & 2),
			vdl3: Boolean(raw[0] & 4),
			unknownMask: raw[0] & ~6,
		};
}

function decodeStationParameters(result: XidParameter): void {
	const { id, raw } = result;
	if (id === 0x40 && raw.length === 2) {
		const channel = (raw[0] & 15) * 256 + raw[1];
		result.autotune = {
			frequency: (Math.ceil(((channel + 10000) * 10) / 25) * 25) / 1000,
			unit: 'MHz',
			modulationMask: raw[0] >>> 4,
		};
	}
	if ([0x82, 0x41, 0x48].includes(id) && raw.length && raw.length % 4 === 0) {
		try {
			result.value = Array.from(
				{ length: raw.length / 4 },
				(_, i) => decodeAvlcAddress(raw.slice(i * 4, i * 4 + 4)).address,
			);
		} catch {
			/* Invalid addresses remain raw. */
		}
	}
	if (id === 0xc3 && raw.length && raw.every((byte) => byte >= 32 && byte <= 126))
		result.value = String.fromCharCode(...raw);
}

export function xidParameterDecoded(parameter: XidParameter): boolean {
	if (parameter.modulations?.unknownMask) return false;
	if (parameter.autotune && parameter.autotune.modulationMask & ~6) return false;
	return [parameter.value, parameter.sequencing, parameter.refusal, parameter.modulations, parameter.autotune].some(
		(value) => value !== undefined,
	);
}
