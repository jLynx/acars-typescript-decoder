export interface AcarsRecord {
	id: number;
	receivedAt: number;
	registration: string;
	mode: string;
	acknowledgement: string;
	label: string;
	blockId: string;
	direction: 'downlink' | 'uplink';
	messageNumber?: string;
	flight?: string;
	text: string;
	continuation: boolean;
}

export type AcarsReport = Omit<AcarsRecord, 'id' | 'receivedAt'>;

import type { AcarsInterpretation, InterpretedAcarsRecord } from './payload/types';

export interface AcarsInput {
	label: string;
	text: string;
	direction?: 'downlink' | 'uplink';
	registration?: string;
	mode?: string;
	acknowledgement?: string;
	blockId?: string;
	messageNumber?: string;
	flight?: string;
	continuation?: boolean;
	receivedAt?: number;
	id?: number;
}

export interface AcarsPlugin {
	name: string;
	decode: (message: Readonly<AcarsRecord>) => AcarsInterpretation | undefined;
}

export interface DecoderOptions {
	airportLookup?: (code: string) => string | undefined;
	plugins?: readonly AcarsPlugin[];
}

export interface AcarsDecoder {
	decode: (message: AcarsInput) => AcarsInterpretation;
	decodeLog: (messages: readonly AcarsRecord[]) => InterpretedAcarsRecord[];
}

export interface DecoderSessionOptions extends DecoderOptions {
	/** Maximum retained sources (default 16, maximum 128). */
	maxSources?: number;
	/** Maximum retained blocks per source (default 512, maximum 10000). */
	maxRecords?: number;
	/** Maximum retained text characters per source (default 1048576). */
	maxCharacters?: number;
	/** Reception-time retention window (default twenty minutes). */
	retentionMs?: number;
}

export interface DecoderSession {
	push: (message: AcarsInput, source?: string) => InterpretedAcarsRecord;
	/** Reinterpret a retained source window, including records completed by a late arrival. */
	snapshot: (source?: string) => InterpretedAcarsRecord[];
	reset: (source?: string) => void;
	stats: () => { sources: number; records: number; characters: number; evictedRecords: number };
}

export interface DecoderSourceState {
	records: AcarsRecord[];
	highWatermark: number;
}
