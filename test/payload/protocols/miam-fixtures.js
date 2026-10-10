import { deflateRawSync } from 'node:zlib';

// Independent CRC polynomial division and ASCII85 encoder for wire fixtures.
export function checksum(bytes, width) {
	let remainder = (1n << BigInt(width)) - 1n;
	const polynomial = width === 32 ? 0x104c11db7n : 0x11021n;
	for (const byte of bytes) {
		remainder ^= BigInt(byte) << BigInt(width - 8);
		for (let bit = 0; bit < 8; bit++) {
			remainder <<= 1n;
			if (remainder & (1n << BigInt(width))) remainder ^= polynomial;
		}
	}
	return Number(width === 32 ? remainder ^ 0xffffffffn : remainder);
}

export function encode85(bytes) {
	const padding = (4 - (bytes.length % 4)) % 4;
	let text = '';
	for (let i = 0; i < bytes.length; i += 4) {
		let value = 0;
		for (let j = 0; j < 4; j++) value = value * 256 + (bytes[i + j] ?? 0);
		let word = '';
		for (let j = 0; j < 5; j++) {
			word = String.fromCharCode(33 + (value % 85)) + word;
			value = Math.floor(value / 85);
		}
		text += word;
	}
	return { text, padding };
}

export function transfer({
	version = 1,
	data = new TextEncoder().encode('NZAA'),
	compression = 1,
	plaintext = false,
	corrupt = false,
	bodyBytes,
	declaredDelta = 0,
	encoding = 0,
} = {}) {
	const body = bodyBytes ?? (compression === 1 ? deflateRawSync(data) : data);
	const header = new Uint8Array(version === 1 ? 20 : 8);
	header[0] = version;
	if (version === 1) {
		const length = header.length + body.length + declaredDelta;
		header.set([length >> 16, (length >> 8) & 255, length & 255], 1);
		header.set(new TextEncoder().encode('.ZK-NZE'), 4);
	}
	const offset = version === 1 ? 11 : 1;
	header[offset] = 7 << 1;
	header[offset + 1] = compression >> 2;
	header[offset + 2] = ((compression & 3) << 6) | (encoding << 4);
	header.set(new TextEncoder().encode('5D'), offset + 3);
	let crc = checksum(data, version === 1 ? 32 : 16) ^ (corrupt ? 1 : 0);
	for (let i = header.length - 1; i >= offset + 5; i--) {
		header[i] = crc & 255;
		crc >>>= 8;
	}
	const encodedHeader = encode85(header);
	const encodedBody = encode85(body);
	return `T${plaintext ? '-' : encodedBody.padding}${encodedHeader.padding}${encodedHeader.text}|${plaintext ? new TextDecoder().decode(body) : encodedBody.text}`;
}
