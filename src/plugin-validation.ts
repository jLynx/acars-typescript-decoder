import { isRecord } from './validation';
import type { AcarsInterpretation } from '@/payload/types';

/** Validate optional protocol output as well as display fields before accepting caller plugins. */
export function validInterpretation(value: unknown, depth = 0): value is AcarsInterpretation {
	if (depth > 4 || !isRecord(value)) return false;
	const base =
		typeof value.title === 'string' &&
		typeof value.summary === 'string' &&
		typeof value.coverage === 'string' &&
		['decoded', 'partial', 'unknown'].includes(value.coverage) &&
		(value.coverageDetail === undefined || typeof value.coverageDetail === 'string') &&
		Array.isArray(value.fields) &&
		value.fields.length <= 256 &&
		value.fields.every(
			(field: unknown) => isRecord(field) && typeof field.label === 'string' && typeof field.value === 'string',
		) &&
		Array.isArray(value.notes) &&
		value.notes.every((note: unknown) => typeof note === 'string');
	if (!base) return false;
	if (value.application !== undefined && !validApplication(value.application)) return false;
	if (value.transfer !== undefined && !validTransfer(value.transfer)) return false;
	return value.embedded === undefined || validInterpretation(value.embedded, depth + 1);
}

function validTransfer(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const type = value.applicationType;
	if (typeof type !== 'number' || !Number.isInteger(type)) return false;
	const length = identifierLength(type, value.version);
	return (
		value.protocol === 'MIAM' &&
		(value.version === 1 || value.version === 2) &&
		length > 0 &&
		typeof value.application === 'string' &&
		value.application.length === length &&
		/^[A-Z0-9]{1,8}$/.test(value.application) &&
		integer(value.encoding, 3) &&
		value.integrity === 'verified' &&
		integer(value.checksum, value.version === 2 ? 0xffff : 0xffffffff) &&
		(value.text === undefined || typeof value.text === 'string') &&
		(value.hex === undefined || (typeof value.hex === 'string' && /^(?:[A-Fa-f0-9]{2})*$/.test(value.hex)))
	);
}

function identifierLength(type: number, version: unknown): number {
	return [2, 4, 6, 6][type] ?? (version === 2 && type >= 8 && type <= 15 && type !== 13 ? type - 7 : 0);
}

function integer(value: unknown, maximum: number): boolean {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function validApplication(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.values) || !isRecord(value.integrity) || !isRecord(value.source))
		return false;
	return (
		['AFN', 'TI2', 'OC1'].includes(String(value.protocol)) &&
		typeof value.variant === 'string' &&
		typeof value.raw === 'string' &&
		strings(value.unconsumed) &&
		value.integrity.status === 'unverified' &&
		(value.integrity.checksum === undefined || typeof value.integrity.checksum === 'string') &&
		typeof value.source.repository === 'string' &&
		typeof value.source.revision === 'string' &&
		strings(value.source.files) &&
		Object.values(value.values).every(
			(item) => typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)) || strings(item),
		)
	);
}

function strings(value: unknown): boolean {
	return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}
