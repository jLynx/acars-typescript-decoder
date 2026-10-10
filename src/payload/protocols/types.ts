import type { AcarsField, AssemblyStatus } from '@/payload/types';
import type { AcarsRecord } from '@/types';
import type { FansCpdlcStructure } from './cpdlc/schema.types';

export interface ApplicationDecode {
	fields: AcarsField[];
	summary: string;
	complete: boolean;
	notes: string[];
	structure?: FansCpdlcStructure;
}

export interface AdscContractDecode {
	fields: AcarsField[];
	notes: string[];
}

export interface CpdlcEntry {
	id: number;
	name: string;
	template: string;
}
export interface CpdlcElement {
	phrase: string;
	complete: boolean;
}
export interface AcarsAssembly {
	first: AcarsRecord;
	last: AcarsRecord;
	text: string;
	blocks: string[];
}

export interface AcarsAssemblyResult {
	completed: Map<number, AcarsAssembly>;
	failures: Map<number, string>;
	statuses: Map<number, AssemblyStatus>;
}
