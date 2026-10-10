import type { AssemblyStatus, InterpretedAcarsRecord } from '@/payload/types';

export function applicationStatus(record: InterpretedAcarsRecord, status: AssemblyStatus): void {
	(record.assemblies ??= []).push(status);
}
