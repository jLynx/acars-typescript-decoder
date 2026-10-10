import type { AtsResult } from './protocols/ats/types';
import type { MiamTransfer } from './protocols/miam/types';

export interface AcarsField {
	label: string;
	value: string;
}

export interface AcarsInterpretation {
	title: string;
	summary: string;
	coverage: 'decoded' | 'partial' | 'unknown';
	coverageDetail?: string;
	fields: AcarsField[];
	notes: string[];
	application?: AtsResult;
	transfer?: MiamTransfer;
	embedded?: AcarsInterpretation;
}

export interface AcarsLabel {
	title: string;
	description: string;
}

export interface CommunityItem {
	type: string;
	code: string;
	label: string;
	value: string;
}

export interface CommunityResult {
	decoded: boolean;
	decoder: { name: string; decodeLevel: string };
	formatted: { description: string; items: CommunityItem[] };
	raw: Record<string, unknown>;
	remaining: { text?: string };
}
import type { AcarsRecord } from '@/types';

export interface InterpretedAcarsRecord extends AcarsRecord {
	interpretation: AcarsInterpretation;
	assembledText?: string;
	assemblies?: AssemblyStatus[];
}

export interface AssemblyStatus {
	protocol: 'ACARS' | 'MIAM' | 'OHMA';
	status: 'pending' | 'complete' | 'duplicate' | 'failed' | 'expired';
	identifier?: string;
	blocks?: string[];
	missing?: string[];
	reason?: string;
}
