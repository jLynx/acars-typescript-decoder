import type { AcarsReport } from '@/types';

export interface AeroSignalUnit {
	protocol: 'Aero';
	channel: 'R' | 'P' | 'T';
	type: number;
	integrity: 'verified' | 'failed';
	raw: Uint8Array;
	payload: Uint8Array;
	aircraft?: number;
	groundStation?: number;
	queue?: number;
	reference?: number;
	sequence?: number;
	total?: number;
	lastLength?: number;
	typeName?: string;
	control?: AeroControl;
}

export interface AeroControl {
	sequence?: number;
	groundStation?: number;
	aircraft?: number;
	satellite?: number;
	longitude?: number;
	longitudeUnit?: 'deg';
	frequencies?: Array<{ role: string; frequency: number; unit: 'Hz'; spotBeam?: boolean }>;
	bitRate?: number;
	bitRateUnit?: 'bit/s';
	bitRateCode?: number;
	raw: Uint8Array;
}

export interface AeroReception {
	/** Directed receiver/circuit identity. P/T SSUs carry no aircraft address and require this context. */
	link: string;
	receivedAt: number;
	direction: 'uplink' | 'downlink';
}

export interface AeroOptions {
	maxMessages?: number;
	maxBytes?: number;
	retentionMs?: number;
}

export interface AeroAssembly {
	status: 'pending' | 'complete' | 'duplicate' | 'failed' | 'ignored';
	unit: AeroSignalUnit;
	fragments: number;
	discarded: string[];
	reason?: string;
	payload?: Uint8Array;
	acars?: AcarsReport;
	aircraft?: number;
	groundStation?: number;
}

export interface AeroReassembler {
	/** R units are 19 bytes; P/T units are 12 bytes; both include the little-endian two-byte FCS. */
	push: (bytes: Uint8Array, channel: AeroSignalUnit['channel'], reception: AeroReception) => AeroAssembly;
	reset: (link?: string) => void;
	stats: () => { messages: number; bytes: number };
}

export interface AeroChain {
	link: string;
	channel: AeroSignalUnit['channel'];
	direction: AeroReception['direction'];
	firstAt: number;
	aircraft: number;
	groundStation: number;
	queue: number;
	reference: number;
	total: number;
	lastLength: number;
	parts: Map<number, Uint8Array>;
	failure?: string;
	complete?: boolean;
}
