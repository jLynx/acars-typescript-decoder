import { isRecord } from '@/validation';

const integer = (value: unknown, maximum: number) =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
function node(value: unknown, begin: number, end: number, state: { count: number }, depth: number): boolean {
	if (!isRecord(value) || depth > 48 || ++state.count > 4096) return false;
	if (typeof value.type !== 'string' || !integer(value.startBit, end) || !integer(value.bitLength, end)) return false;
	const start = value.startBit as number;
	const length = value.bitLength as number;
	if (start < begin || start + length > end) return false;
	const optionalText = ['name', 'choice', 'enumeration'].every(
		(key) => value[key] === undefined || typeof value[key] === 'string',
	);
	const scalar =
		value.value === undefined ||
		value.value === null ||
		typeof value.value === 'string' ||
		typeof value.value === 'boolean' ||
		(typeof value.value === 'number' && Number.isFinite(value.value));
	return (
		optionalText &&
		scalar &&
		(value.children === undefined ||
			(Array.isArray(value.children) &&
				value.children.length <= 128 &&
				value.children.every((child: unknown) => node(child, start, start + length, state, depth + 1))))
	);
}

export function validCpdlcStructure(value: unknown): boolean {
	if (
		!isRecord(value) ||
		!(value.raw instanceof Uint8Array) ||
		!value.raw.length ||
		value.raw.length > 8192 ||
		!isRecord(value.source)
	)
		return false;
	return (
		value.protocol === 'FANS-CPDLC' &&
		['uplink', 'downlink'].includes(String(value.direction)) &&
		value.integrity === 'unverified' &&
		typeof value.paddingValid === 'boolean' &&
		integer(value.consumedBits, value.raw.length * 8) &&
		typeof value.source.repository === 'string' &&
		typeof value.source.revision === 'string' &&
		Array.isArray(value.source.files) &&
		value.source.files.every((file: unknown) => typeof file === 'string') &&
		isRecord(value.value) &&
		value.value.startBit === 0 &&
		value.value.bitLength === value.consumedBits &&
		node(value.value, 0, value.consumedBits as number, { count: 0 }, 0)
	);
}
