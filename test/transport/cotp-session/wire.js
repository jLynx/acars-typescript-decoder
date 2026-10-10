// Independent RFC 905 wire encoder; synthetic fixture values, no captured traffic.
export function tpdu(fixed, parameters = [], payload = [], protectedPacket = true) {
	const header = [...fixed, ...parameters.flatMap(([id, values]) => [id, values.length, ...values])];
	const offset = header.length + 3;
	if (protectedPacket) header.push(0xc3, 2, 0, 0);
	const bytes = Uint8Array.from([header.length, ...header, ...payload]);
	if (!protectedPacket) return bytes;
	let sum = 0,
		weighted = 0;
	for (const byte of bytes) {
		sum = (sum + byte) % 255;
		weighted = (weighted + sum) % 255;
	}
	bytes[offset] = ((bytes.length - offset - 1) * sum - weighted + 255 * 256) % 255;
	bytes[offset + 1] = (-sum - bytes[offset] + 510) % 255;
	return bytes;
}
export function connect(
	type = 0xe0,
	{
		destination = type === 0xe0 ? 0 : 11,
		source = type === 0xe0 ? 11 : 22,
		protocolClass = 4,
		extended = false,
		credit = 3,
		size,
		additional,
		version,
		parameters = [],
		payload = [],
		checksum = true,
	} = {},
) {
	const parts = [...parameters];
	if (size !== undefined) parts.push([0xc0, [size]]);
	if (additional !== undefined) parts.push([0xc6, [additional]]);
	if (version !== undefined) parts.push([0xc4, [version]]);
	return tpdu(
		[
			type | credit,
			destination >> 8,
			destination & 255,
			source >> 8,
			source & 255,
			protocolClass * 16 + (extended ? 2 : 0),
		],
		parts,
		payload,
		checksum,
	);
}
export function data(
	sequence = 0,
	payload = [7],
	{ reference = 22, extended = false, end = true, expedited = false, requestAck = false, parameters = [] } = {},
) {
	const encoded = extended
		? [(sequence >>> 24) | (end ? 128 : 0), (sequence >>> 16) & 255, (sequence >>> 8) & 255, sequence & 255]
		: [sequence | (end ? 128 : 0)];
	return tpdu(
		[expedited ? 0x10 : 0xf0 | (requestAck ? 1 : 0), reference >> 8, reference & 255, ...encoded],
		parameters,
		payload,
	);
}

export function ack(
	sequence = 0,
	{ reference = 11, extended = false, expedited = false, credit = 3, parameters = [] } = {},
) {
	const encoded = extended
		? [(sequence >>> 24) & 127, (sequence >>> 16) & 255, (sequence >>> 8) & 255, sequence & 255]
		: [sequence];
	const code = expedited ? 0x20 : 0x60 | (extended ? 0 : credit);
	const fixed = [code, reference >> 8, reference & 255, ...encoded];
	if (extended && !expedited) fixed.push(credit >> 8, credit & 255);
	return tpdu(fixed, parameters);
}

export function fcc(lower, subsequence, credit) {
	return [
		0x8c,
		[
			(lower >>> 24) & 255,
			(lower >>> 16) & 255,
			(lower >>> 8) & 255,
			lower & 255,
			subsequence >> 8,
			subsequence & 255,
			credit >> 8,
			credit & 255,
		],
	];
}
export function release(type = 0x80, { reference = 22, source = 11 } = {}) {
	const fixed = [type, reference >> 8, reference & 255, source >> 8, source & 255];
	if (type === 0x80) fixed.push(0);
	return tpdu(fixed);
}
export const receive = (receivedAt = 0, direction = 'a-to-b', link = 'receiver:peers') => ({
	receivedAt,
	direction,
	link,
});
export function establish(
	session,
	request = {},
	confirmation = {},
	at = 0,
	link = 'receiver:peers',
	direction = 'a-to-b',
) {
	session.push(connect(0xe0, request), receive(at, direction, link));
	return session.push(connect(0xd0, confirmation), receive(at, direction === 'a-to-b' ? 'b-to-a' : 'a-to-b', link));
}
