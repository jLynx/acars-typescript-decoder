export interface MiamBody {
	version: number;
	applicationType: number;
	application: string;
	compression: number;
	encoding: number;
	checksum: number;
	length?: number;
	headerLength: number;
}

export interface MiamTransfer {
	protocol: 'MIAM';
	version: number;
	applicationType: number;
	application: string;
	encoding: number;
	integrity: 'verified';
	checksum: number;
	text?: string;
	hex?: string;
}

export type MiamFileFrame =
	| { type: 'F'; fileId: string; size: number; validity: string }
	| { type: 'K'; fileId: string; segmentSize: number; groundTempo: number; flightTempo: number }
	| { type: 'S'; fileId: string; sequence: number; text: string }
	| { type: 'A'; fileId: string; reason: number }
	| { type: 'Y'; fileId: string }
	| { type: 'X'; fileId: string; groundTempo: number; flightTempo: number };

import type { InterpretedAcarsRecord } from '@/payload/types';

export interface MiamFileChain {
	first: InterpretedAcarsRecord;
	last: InterpretedAcarsRecord;
	request: Extract<MiamFileFrame, { type: 'F' }>;
	parts: Map<number, string>;
	length: number;
}
