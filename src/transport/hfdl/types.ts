import type { AcarsReport } from '@/types';

export interface HfdlFrame {
	protocol: 'HFDL';
	type: 'SPDU' | 'MPDU';
	/** SPDU CRC or MPDU header CRC. Each LPDU has its own CRC. */
	integrity: 'verified' | 'failed';
	raw: Uint8Array;
	unconsumed: Uint8Array;
	spdu?: HfdlSpdu;
	mpdu?: HfdlMpdu;
}

export interface HfdlStation {
	id: number;
	utcSynchronized: boolean;
	frequenciesInUseMask: number;
}

export interface HfdlSpdu {
	groundStation: number;
	version: number;
	rlsInUse: boolean;
	iso8208Supported: boolean;
	change: number;
	changeName: string;
	tdmaFrameIndex: number;
	tdmaFrameOffset: number;
	minimumPriority: number;
	systemTableVersion: number;
	stations: HfdlStation[];
	/** Slot allocation bytes are retained until their full schema is implemented. */
	slotsRaw: Uint8Array;
}

export interface HfdlMpdu {
	direction: 'uplink' | 'downlink';
	groundStation: number;
	aircraft: Array<{ id: number; lengths: number[]; lpdus: HfdlLpdu[] }>;
}

export interface HfdlLpdu {
	index: number;
	integrity: 'verified' | 'failed' | 'incomplete';
	raw: Uint8Array;
	type?: number;
	typeName?: string;
	icaoAddress?: number;
	reason?: number;
	aircraftId?: number;
	hfnpdu?: Hfnpdu;
}

export interface Hfnpdu {
	type: number;
	typeName: string;
	raw: Uint8Array;
	systemTable?: { total: number; sequence: number; version: number };
	requestData?: number;
	acars?: AcarsReport;
	report?: HfdlReport;
}

export interface HfdlReport {
	flight: string;
	position: { latitude: number; longitude: number; unit: 'deg' };
	/** Seconds after UTC midnight, without an inferred date. */
	time: number;
	timeUnit: 's';
	performance?: {
		version: number;
		flightLeg: number;
		groundStation: number;
		frequencyId: number;
		frequencySearches: { previousLeg: number; currentLeg: number };
		hfDisabled: { previousLeg: number; currentLeg: number; unit: 's' };
		mpdusReceived: HfdlRateCounts;
		mpdusWithErrors: HfdlRateCounts;
		spdusReceived: number;
		spdusMissed: number;
		mpdusTransmitted: HfdlRateCounts;
		mpdusDelivered: HfdlRateCounts;
		frequencyChange: number;
		frequencyChangeName: string;
	};
	frequencies?: Array<{ groundStation: number; propagatingMask: number; heardMask: number }>;
	unconsumed: Uint8Array;
}

/** Counts keyed by the documented bit rate in bits per second. */
export interface HfdlRateCounts {
	300: number;
	600: number;
	1200: number;
	1800: number;
}

export interface HfdlSystemTableStation {
	id: number;
	utcSynchronized: boolean;
	position: { latitude: number; longitude: number; unit: 'deg' };
	spduVersion: number;
	frequencies: Array<{ frequency: number; unit: 'Hz'; masterFrameSlot: number; raw: Uint8Array }>;
	raw: Uint8Array;
}

export interface HfdlSystemTable {
	version: number;
	stations: HfdlSystemTableStation[];
	raw: Uint8Array;
	unconsumed: Uint8Array;
	status: 'decoded' | 'partial' | 'failed';
	reason?: string;
}

export interface HfdlSystemTableOptions {
	/** Defaults: 64 source/version sets, 65535 bytes per table, 60000 ms retention. */
	maxSets?: number;
	maxBytes?: number;
	retentionMs?: number;
}

export interface HfdlSystemTableReception {
	/** Receiver/network identity; tables from separate networks must never share a source. */
	source: string;
	receivedAt: number;
}

export interface HfdlSystemTableEvent {
	status: 'pending' | 'complete' | 'duplicate' | 'failed';
	version: number;
	sequence: number;
	total: number;
	fragments: number;
	reason?: string;
	table?: HfdlSystemTable;
	/** Whether a fully decoded version replaces the current table for this source. */
	selected?: boolean;
}

export interface HfdlSystemTableResult {
	frame: HfdlFrame;
	events: HfdlSystemTableEvent[];
	discarded: string[];
}

export interface HfdlSystemTableAssembler {
	/** Accept complete demodulated HFDL frames; only CRC-verified LPDUs enter table state. */
	push: (bytes: Uint8Array, reception: HfdlSystemTableReception) => HfdlSystemTableResult;
	current: (source: string) => HfdlSystemTable | undefined;
	reset: (source?: string) => void;
	stats: () => { sets: number; bytes: number; sources: number };
}

export interface HfdlSystemTableSet {
	source: string;
	version: number;
	total: number;
	firstAt: number;
	parts: Map<number, Uint8Array>;
	length: number;
	failure?: string;
	complete?: boolean;
}
