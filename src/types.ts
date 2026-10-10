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
