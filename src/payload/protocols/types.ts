import type { AcarsField } from '@/payload/types';
import type { AcarsRecord } from '@/types';

export interface ApplicationDecode {
	fields: AcarsField[];
	summary: string;
	complete: boolean;
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
}
