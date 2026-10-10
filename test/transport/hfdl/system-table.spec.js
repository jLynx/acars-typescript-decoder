import { describe, expect, it } from 'vitest';
import { createHfdlSystemTableAssembler, decodeHfdlSystemTable, isHfdlTableNewer } from '@/index';

// Synthetic encoder: pack two signed coordinates and six decimal digits, independent of parser operations.
const station = (id = 5, frequency = 11384000, slot = 12) => {
	const lat = BigInt(Math.round((-36.9 / 180) * 524287)) & 1048575n;
	const lon = BigInt(Math.round((174.8 / 180) * 524287)) & 1048575n;
	const position = lat | (lon << 20n);
	const digits = String(frequency / 100).padStart(6, '0');
	return Uint8Array.from([
		128 + id,
		...Array.from({ length: 5 }, (_, i) => Number((position >> BigInt(i * 8)) & 255n)),
		10,
		...[4, 2, 0].map((i) => Number(digits[i]) * 16 + Number(digits[i + 1])),
		slot,
	]);
};
const crc = (body) => {
	let value = 65535;
	for (const byte of body)
		for (let bit = 0; bit < 8; bit++) {
			const low = (value ^ (byte >> bit)) & 1;
			value = (value >>> 1) ^ (low ? 0x8408 : 0);
		}
	value ^= 65535;
	return [...body, value & 255, value >>> 8];
};
const frame = (body, sequence = 0, total = 1, version = 35) => {
	const lpdu = crc([13, 255, 208, (total - 1) * 16 + sequence, (version & 15) * 16, version >>> 4, ...body]);
	return Uint8Array.from([...crc([7, 5, 42, 0, 0, 0, lpdu.length - 1]), ...lpdu]);
};
const push = (engine, body, sequence = 0, total = 1, version = 35, receivedAt = 0, source = 'test') =>
	engine.push(frame(body, sequence, total, version), { source, receivedAt });

describe('HFDL system-table records and CRC-gated indexed assembly', () => {
	it('decodes multiple stations, Hz, slot index, sync and signed coordinates', () => {
		const table = decodeHfdlSystemTable(Uint8Array.from([...station(), ...station(6, 21934000, 15)]), 4095);
		expect(table.status).toBe('decoded');
		expect(table.stations[0]).toMatchObject({
			id: 5,
			utcSynchronized: true,
			spduVersion: 2,
			frequencies: [{ frequency: 11384000, unit: 'Hz', masterFrameSlot: 12 }],
		});
		expect(table.stations[0].position.latitude).toBeCloseTo(-36.9, 3);
		expect(table.stations[1].position.longitude).toBeCloseTo(174.8, 3);
		expect(table.stations[1].frequencies[0].frequency).toBe(21934000);
	});
	it('assembles out of order, suppresses duplicates, and clones current/raw state', () => {
		const e = createHfdlSystemTableAssembler(),
			body = station();
		expect(push(e, body.slice(4), 1, 2).events[0].status).toBe('pending');
		expect(push(e, body.slice(4), 1, 2).events[0].status).toBe('duplicate');
		const result = push(e, body.slice(0, 4), 0, 2);
		expect(result.events[0]).toMatchObject({
			status: 'complete',
			fragments: 2,
			selected: true,
			table: { version: 35, status: 'decoded' },
		});
		result.events[0].table.stations[0].id = 0;
		const current = e.current('test');
		expect(current.stations[0].id).toBe(5);
		current.raw[0] = 0;
		expect(e.current('test').raw[0]).toBe(133);
		expect(push(e, body.slice(0, 4), 0, 2).events[0].status).toBe('duplicate');
	});
	it('isolates sources, fragment counts and interleaved versions', () => {
		const e = createHfdlSystemTableAssembler(),
			body = station();
		push(e, body.slice(0, 4), 0, 2, 35, 0, 'a');
		expect(push(e, body.slice(4), 1, 2, 35, 0, 'b').events[0].status).toBe('pending');
		push(e, body.slice(0, 4), 0, 2, 36, 0, 'a');
		expect(push(e, body.slice(4), 1, 3, 35, 0, 'a').events[0].status).toBe('pending');
		expect(push(e, body.slice(4), 1, 2, 35, 0, 'a').events[0].status).toBe('complete');
		expect(e.current('b')).toBeUndefined();
	});
	it('keeps conflicts quarantined until reset and ignores CRC-failed tables', () => {
		const e = createHfdlSystemTableAssembler(),
			body = station();
		push(e, body.slice(0, 4), 0, 2);
		expect(push(e, [9], 0, 2).events[0].reason).toMatch(/Conflicting/);
		expect(push(e, body.slice(4), 1, 2).events[0].status).toBe('failed');
		e.reset('test');
		const bad = frame(body);
		bad[12] ^= 1;
		expect(e.push(bad, { source: 'test', receivedAt: 0 }).events).toEqual([]);
		expect(push(e, body).events[0].status).toBe('complete');
	});
	it('withdraws a selected version if a later verified fragment contradicts its contents', () => {
		const e = createHfdlSystemTableAssembler();
		push(e, station());
		expect(e.current('test')).toBeTruthy();
		expect(push(e, station(6)).events[0].status).toBe('failed');
		expect(e.current('test')).toBeUndefined();
		expect(push(e, station()).events[0].status).toBe('failed');
	});
	it('handles wrap, older versions and the ambiguous half cycle', () => {
		const e = createHfdlSystemTableAssembler();
		push(e, station(), 0, 1, 4095);
		expect(push(e, station(), 0, 1, 0).events[0].selected).toBe(true);
		expect(push(e, station(), 0, 1, 4094).events[0].selected).toBe(false);
		expect(push(e, station(), 0, 1, 2048).events[0].selected).toBe(false);
		expect(isHfdlTableNewer(0, 4095)).toBe(true);
		expect(isHfdlTableNewer(4095, 0)).toBe(false);
		expect(e.current('test').version).toBe(0);
	});
	it('bounds memory, expires incomplete/duplicate records, resets and rejects backward time', () => {
		const e = createHfdlSystemTableAssembler({ maxSets: 1, retentionMs: 10, maxBytes: 12 });
		push(e, [1], 0, 2, 1);
		expect(push(e, [2], 0, 2, 2, 1).discarded).toHaveLength(1);
		expect(push(e, [3], 1, 2, 2, 11).discarded).toHaveLength(1);
		expect(e.stats().sets).toBe(1);
		e.reset();
		expect(e.stats().bytes).toBe(0);
		expect(push(e, new Uint8Array(13)).events[0].status).toBe('failed');
		push(e, station(), 0, 1, 2, 20);
		expect(() => push(e, station(), 0, 1, 3, 19)).toThrow(/backwards/);
	});
	it('retains malformed bytes and rejects BCD/count/coordinate/duplicate/truncated cases', () => {
		const invalid = [];
		const bcd = station();
		bcd[7] = 0xfa;
		invalid.push(bcd);
		const count = station();
		count[6] = 31 * 8;
		invalid.push(count);
		const coordinate = station();
		coordinate.set([255, 255, 7], 1);
		invalid.push(coordinate);
		invalid.push(Uint8Array.from([...station(), ...station()]));
		for (let length = 1; length < 11; length++) invalid.push(station().slice(0, length));
		for (const bytes of invalid) {
			const t = decodeHfdlSystemTable(bytes, 1);
			expect(t.status).toBe('failed');
			expect(t.unconsumed.length).toBeGreaterThan(0);
		}
		for (const version of [-1, 4096, NaN]) expect(() => decodeHfdlSystemTable(station(), version)).toThrow();
		expect(() => createHfdlSystemTableAssembler({ maxSets: 0 })).toThrow();
	});
});
