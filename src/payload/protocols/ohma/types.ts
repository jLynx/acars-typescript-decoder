import type { AcarsRecord } from '@/types';

export interface OhmaOuter {
	version: string;
	message: string;
	convo_id?: string;
	msg_seq?: number;
	msg_total?: number;
}

export interface OhmaConversation {
	first: AcarsRecord;
	last: AcarsRecord;
	version: string;
	total?: number;
	parts: Map<number, string>;
	length: number;
	failure?: string;
}
