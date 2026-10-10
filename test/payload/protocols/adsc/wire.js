// Locally authored MSB-first encoder and polynomial long division, independent of runtime helpers.
export function packed(...parts) {
	let value = parts
		.map(([width, number]) => BigInt.asUintN(width, BigInt(number)).toString(2).padStart(width, '0'))
		.join('');
	value = value.padEnd(Math.ceil(value.length / 8) * 8, '0');
	return Uint8Array.from(value.match(/.{8}/g) ?? [], (byte) => parseInt(byte, 2));
}

export function envelope(bytes, imi = 'ADS') {
	const prefix = imi + '.N123AB';
	let dividend = BigInt('0x' + Buffer.from(prefix).toString('hex') + Buffer.from(bytes).toString('hex')) << 16n;
	// Divide message*x^16 by x^16+x^12+x^5+1 with initial register FFFF.
	const dataBits = (prefix.length + bytes.length) * 8;
	dividend ^= 0xffffn << BigInt(dataBits);
	for (let position = dataBits + 15; position >= 16; position--) {
		if ((dividend >> BigInt(position)) & 1n) dividend ^= 0x11021n << BigInt(position - 16);
	}
	const checksum = Number(dividend ^ 0xffffn)
		.toString(16)
		.padStart(4, '0')
		.toUpperCase();
	return '/TEST.' + prefix + Buffer.from(bytes).toString('hex').toUpperCase() + checksum;
}
