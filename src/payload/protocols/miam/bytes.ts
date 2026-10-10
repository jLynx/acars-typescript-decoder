import { Inflate, type ZStream } from 'pako';

export function base85(text: string, padding: number, maximum = 8192): Uint8Array {
	const bytes: number[] = [];
	for (let i = 0; i < text.length;) {
		if (text[i] === 'z') {
			bytes.push(0, 0, 0, 0);
			i++;
		} else {
			if (i + 5 > text.length) throw new Error('Incomplete ASCII85 word');
			let value = 0;
			for (let digit = 0; digit < 5; digit++) {
				const code = text.charCodeAt(i++);
				if (code < 33 || code > 117) throw new Error('Invalid ASCII85 digit');
				value = value * 85 + code - 33;
			}
			if (value > 0xffffffff) throw new Error('ASCII85 word overflow');
			bytes.push(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
		}
		if (bytes.length > maximum) throw new Error('Decoded transfer exceeds byte limit');
	}
	if (padding < 0 || padding > 3 || padding > bytes.length) throw new Error('Invalid ASCII85 padding');
	return Uint8Array.from(bytes.slice(0, bytes.length - padding));
}

/** ARINC 665 uses the non-reflected 0x04c11db7 polynomial and a final complement. */
export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte << 24;
		for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
	}
	return ~crc >>> 0;
}

export function crc16(bytes: Uint8Array): number {
	let crc = 0xffff;
	for (const byte of bytes) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
	}
	return crc;
}

export function inflateBounded(bytes: Uint8Array, maximum = 65536, raw = true): Uint8Array {
	// MIAM uses raw DEFLATE, not a zlib/gzip envelope.
	const inflater = new Inflate({ raw, chunkSize: 4096 });
	let stream: ZStream | undefined;
	// Pako 3 exposes stream state through this hook; its internal strm is private.
	inflater.onStart = (state) => {
		stream = state;
	};
	const chunks: Uint8Array[] = [];
	let size = 0;
	inflater.onData = (chunk: Uint8Array) => {
		size += chunk.length;
		if (size > maximum) throw new Error('Decompressed transfer exceeds byte limit');
		chunks.push(chunk);
	};
	if (!inflater.push(bytes, true) || inflater.err) throw new Error('Invalid or incomplete DEFLATE body');
	if (!inflater.ended || stream?.avail_in !== 0) throw new Error('Incomplete DEFLATE stream or trailing data');
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}
