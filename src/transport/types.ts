import type { AcarsReport, AcarsInput } from '@/types';

export interface AvlcAddress {
	address: number;
	addressType: number;
	kind: 'aircraft' | 'ground' | 'broadcast' | 'unknown';
	status: boolean;
}

export type AvlcControl =
	| { type: 'I'; sendSequence: number; receiveSequence: number; pollFinal: boolean }
	| { type: 'S'; function: 'RR' | 'RNR' | 'REJ' | 'SREJ'; receiveSequence: number; pollFinal: boolean }
	| { type: 'U'; function: string; code: number; pollFinal: boolean };

export interface AvlcFrame {
	protocol: 'AVLC';
	destination: AvlcAddress;
	source: AvlcAddress;
	control: AvlcControl;
	integrity: 'verified' | 'failed';
	raw: Uint8Array;
	payload?: {
		kind: 'acars' | 'x25' | 'xid' | 'unknown';
		bytes: Uint8Array;
		acars?: AcarsReport;
		xid?: XidMessage;
		x25?: X25Packet;
	};
}

import type { X25Packet } from './network/types';

export interface XidParameter {
	id: number;
	name: string;
	raw: Uint8Array;
	value?: string | number | number[] | XidLocation | XidFrequency[];
	unit?: 'ft' | 'MHz';
	sequencing?: { sequence: number; retry: number };
	refusal?: { cause: number; delayRaw: number; additional: Uint8Array };
	modulations?: { mask: number; vdl2: boolean; vdl3: boolean; unknownMask: number };
	autotune?: { frequency: number; unit: 'MHz'; modulationMask: number };
}

export interface XidLocation {
	latitude: number;
	longitude: number;
	altitude?: number;
	altitudeUnit?: 'ft';
}

export interface XidFrequency {
	frequency: number;
	unit: 'MHz';
	modulation: number;
	modulationName: string;
	groundAddress: number;
}

export interface XidMessage {
	protocol: 'XID';
	type: string;
	description: string;
	coverage: 'decoded' | 'partial';
	raw: Uint8Array;
	groups: Array<{ id: number; parameters: XidParameter[] }>;
	notes: string[];
}

export interface ReceiverRecord {
	message: AcarsInput;
	source: string;
	raw: Record<string, unknown>;
	/** Receiver-reported errors, separate from locally verified application integrity. */
	errors?: number;
}
