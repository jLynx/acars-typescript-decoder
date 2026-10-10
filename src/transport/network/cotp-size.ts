// ITU-T X.224 (11/1995) §13.3.4 c): unsigned, big-endian multiples of 128 octets.
export function preferredTpduSize(raw: Uint8Array): number | undefined {
	if (!raw.length || raw.length > 4) return;
	let units = 0;
	for (const byte of raw) units = units * 256 + byte;
	return units ? units * 128 : undefined;
}

export function cotpInputLimit(value: number | undefined): number {
	const size = value ?? 8192;
	if (!Number.isSafeInteger(size) || size < 2 || size > 65535) throw new RangeError('Invalid COTP NSDU input limit');
	return size;
}
