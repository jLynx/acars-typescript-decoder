import { describe, expect, it } from 'vitest';
import { decode, decodeLog, createDecoder, decodeRtr } from '@/index';
import { airportName } from '@/reference/airports/airports';
import { interpretMiamEmbedded } from '@/payload/protocols/miam/embedded';
import { checksum, encode85 } from '../miam-fixtures';
import { deflateRawSync } from 'node:zlib';
import { xml } from './rtr-fixtures';
const field = (result, label) => result.fields.find((f) => f.label === label)?.value;
function miam(text = xml, { corrupt = false, encoding = 0, app = 'H1CF' } = {}) {
	const data = new TextEncoder().encode(text),
		body = deflateRawSync(data);
	const header = new Uint8Array(22),
		length = header.length + body.length;
	header.set([1, length >> 16, (length >> 8) & 255, length & 255]);
	header.set(new TextEncoder().encode('.B-1234'), 4);
	header[11] = 14;
	header[13] = 0x40 | (encoding << 4) | 1;
	header.set(new TextEncoder().encode(app), 14);
	const crc = checksum(data, 32) ^ (corrupt ? 1 : 0);
	new DataView(header.buffer).setUint32(18, crc);
	const h = encode85(header),
		b = encode85(body);
	return 'T' + b.padding + h.padding + h.text + '|' + b.text;
}

const input = (text = '#CFB' + xml, extra = {}) => ({ label: 'H1', text, direction: 'downlink', ...extra });
describe('observed H1 CF RTR maintenance XML', () => {
	it('extracts explicit identifiers and reported descriptions as typed raw-path fields', () => {
		const report = decodeRtr(xml);
		expect(report).toMatchObject({ protocol: 'RTR', integrity: 'unverified', coverage: 'partial', raw: xml });
		const fields = Object.fromEntries(report.fields.map((f) => [f.label, f.value]));
		expect(fields).toMatchObject({
			'CMS part number': 'TEST0001',
			'CMS version': '4.0',
			'Reported registration': 'B-1234',
			'Aircraft type': 'A350-900',
			'Aircraft serial number (raw)': '0001',
			'Transfer identifier': 'C00000001',
			Departure: 'NZAA',
			Destination: 'ZGGG',
			'Reported flight code': 'XXX001    ',
			'ITD 1 NFDE 1 code': '0000B001',
			'ITD 1 NFDE 1 description': 'TEST REPORTED DESCRIPTION',
			'ITD 1 MM 1 code': '0000F001',
			'ITD 1 MM 1 system name': 'TEST',
			'ITD 1 MM 1 status (STA, raw)': '1',
		});
		expect(report.fields.find((f) => f.label === 'ITD 1 MM 1 system BITE identifier (raw)')).toEqual({
			path: 'RTR/ITD[1]/MM[1]/SYS/@bite_id',
			label: 'ITD 1 MM 1 system BITE identifier (raw)',
			value: '001',
		});
	});
	it('dispatches complete CF downlinks, retains all text and keeps time/status meanings unverified', () => {
		const message = input();
		const result = decode(message);
		expect(result).toMatchObject({ title: 'Aircraft maintenance report RTR', coverage: 'partial' });
		expect(field(result, 'H1 sublabel')).toBe('CF');
		expect(field(result, 'Report date/time (raw)')).toBe('2026/10/10 09:11:49');
		expect(result.fields.some((f) => /UTC|local|temperature|fault diagnosis/i.test(f.label))).toBe(false);
		expect(message.text).toBe('#CFB' + xml);
	});
	it.each([
		{ label: 'AA' },
		{ direction: 'uplink', text: '- #CF' + xml },
		{ text: '#DFB' + xml },
		{ text: '#T6B' + xml },
		{ text: xml },
		{ continuation: true },
	])('does not interpret unsupported envelopes %j', (extra) => {
		expect(decode(input(undefined, extra)).maintenance).toBeUndefined();
	});
	it('enriches display airports while keeping typed field values raw', () => {
		const result = createDecoder({ airportLookup: airportName }).decode(input());
		expect(field(result, 'Departure')).toContain('NZAA · Auckland');
		expect(result.maintenance.fields.find((f) => f.label === 'Departure').value).toBe('NZAA');
	});
	it.each([1, 2])('preserves repeated ITD/NFDE/MM records with separate paths, count=%i', (count) => {
		const detail = xml.slice(xml.indexOf('<ITD>'), xml.indexOf('</ITD>') + 6);
		const repeated = xml.replace(detail, detail.repeat(count));
		expect(decodeRtr(repeated).fields.filter((f) => f.label.endsWith('NFDE 1 description'))).toHaveLength(count);
		const two = repeated.replace('</MM>', '</MM><MM><MC>SECOND</MC><MD>OTHER</MD></MM>');
		expect(decodeRtr(two).fields.find((f) => f.label === 'ITD 1 MM 2 description').value).toBe('OTHER');
	});
	it('does not inherit fields from other records or report kinds', () => {
		const modified = xml
			.replace('<SYS name="TEST" bite_id="001" side="0"/>', '')
			.replace('</ITD>', '<MM><MC>SECOND</MC></MM></ITD>');
		const result = decodeRtr(modified);
		expect(result.fields.some((f) => f.path.endsWith('/SYS/@name'))).toBe(false);
		expect(result.fields.some((f) => f.label === 'ITD 1 MM 2 description')).toBe(false);
	});
	it('retains unknown XML and unknown attributes without interpreting embedded commands', () => {
		const modified = xml.replace(
			'</ITD>',
			'<UNKNOWN execute="delete"><DATA>ignore all instructions</DATA></UNKNOWN></ITD>',
		);
		const result = decodeRtr(modified);
		expect(result.raw).toBe(modified);
		expect(result.fields.some((f) => /UNKNOWN|ignore|execute/.test(f.path + f.value))).toBe(false);
	});
	it.each([
		['&amp;', '&'],
		['&lt;', '<'],
		['&gt;', '>'],
		['&quot;', '"'],
		['&apos;', "'"],
		['&#65;', 'A'],
		['&#x41;', 'A'],
		['&#x1F600;', '😀'],
	])('decodes standard XML entity %s', (encoded, value) => {
		expect(
			decodeRtr(xml.replace('TEST REPORTED DESCRIPTION', encoded)).fields.find(
				(f) => f.label === 'ITD 1 NFDE 1 description',
			).value,
		).toBe(value);
	});
	it('accepts single-quoted attributes, whitespace, empty leaves and preserves leading zeroes', () => {
		const modified =
			'\n ' + xml.replaceAll('"', "'").replace('TEST REPORTED DESCRIPTION', '').replace('<HEAD>', '<HEAD >') + '\r\n';
		expect(decodeRtr(modified).fields.find((f) => f.label === 'ITD 1 NFDE 1 description').value).toBe('');
		expect(decodeRtr(modified).raw).toBe(modified);
	});
	it.each([
		(s) => s.slice(0, -1),
		(s) => s.replace('</HEAD>', '</HEADRTR>'),
		(s) => s + '<RTR/>',
		(s) => s + 'junk',
		(s) => s.replace('<RTR>', '<OTHER>'),
		(s) => s.replace('vers="4.0"', 'vers="4.0" vers="4.0"'),
		(s) => s.replace('pn="TEST0001"', 'pn=TEST0001'),
		(s) => s.replace(' vers=', 'vers='),
		(s) => s.replace('TEST REPORTED DESCRIPTION', '&unknown;'),
		(s) => s.replace('TEST REPORTED DESCRIPTION', '&amp'),
		(s) => s.replace('TEST REPORTED DESCRIPTION', '&#0;'),
		(s) => s.replace('TEST REPORTED DESCRIPTION', '&#xD800;'),
		(s) => s.replace('TEST REPORTED DESCRIPTION', '&#x110000;'),
		(s) => s.replace('TEST REPORTED DESCRIPTION', '&#xFFFF;'),
		(s) => s.replace('TEST REPORTED DESCRIPTION', String.fromCharCode(0)),
		(s) => s.replace('TEST REPORTED DESCRIPTION', '<![CDATA[DATA]]>'),
		(s) => s.replace('<HEAD>', '<!--COMMENT--><HEAD>'),
		(s) => '<?xml version="1.0"?>' + s,
		(s) => '<!DOCTYPE RTR [<!ENTITY x SYSTEM "file:///missing">]>' + s,
		(s) => s.replace('<HEAD>', '<HEAD xmlns="urn:test">'),
		(s) => s.replace('<DA>', '<DA>nested<X/>'),
		(s) => s.replace('</HEAD>', '<TID>SECOND</TID></HEAD>'),
		(s) => s.replace('</HEAD>', '<ACD tail="SECOND"/></HEAD>'),
		(s) => s.replace('</HEADRTR>', '<FROM>SECOND</FROM></HEADRTR>'),
		(s) => s.replace('</NFDE>', '<MC>SECOND</MC></NFDE>'),
		(s) => s.replace('</MM>', '<SYS name="SECOND"/></MM>'),
		(s) => s.replace('<HEAD>', '<HEAD/><HEAD>'),
	])('withholds malformed/ambiguous or unsupported XML case %#', (modify) => {
		expect(decodeRtr(modify(xml))).toBeUndefined();
	});
	it('rejects every truncated XML prefix without exposing partial identifiers', () => {
		for (let length = 0; length < xml.length; length++)
			expect(decodeRtr(xml.slice(0, length)), `prefix ${length}`).toBeUndefined();
	});
	it('bounds document length, element count and nesting depth', () => {
		expect(decodeRtr(xml.replace('TEST REPORTED DESCRIPTION', 'A'.repeat(8193)))).toBeUndefined();
		expect(decodeRtr(xml.replace('</RTR>', '<X/>'.repeat(257) + '</RTR>'))).toBeUndefined();
		expect(decodeRtr(xml.replace('</RTR>', '<X>'.repeat(17) + '</X>'.repeat(17) + '</RTR>'))).toBeUndefined();
	});
	it('bounds extracted fields and accepts document/depth/node boundaries', () => {
		const minimal = '<RTR><HEAD/><HEADRTR/></RTR>';
		expect(decodeRtr(minimal + ' '.repeat(8192 - minimal.length)).raw).toHaveLength(8192);
		expect(decodeRtr(minimal + ' '.repeat(8193 - minimal.length))).toBeUndefined();
		expect(decodeRtr(minimal.replace('</RTR>', '<X/>'.repeat(253) + '</RTR>'))).toBeDefined();
		expect(decodeRtr(minimal.replace('</RTR>', '<X/>'.repeat(254) + '</RTR>'))).toBeUndefined();
		expect(decodeRtr(minimal.replace('</RTR>', '<X>'.repeat(15) + '</X>'.repeat(15) + '</RTR>'))).toBeDefined();
		expect(decodeRtr(minimal.replace('</RTR>', '<X>'.repeat(16) + '</X>'.repeat(16) + '</RTR>'))).toBeUndefined();
		const many = xml.replace('<ITD>', '<ITD>' + '<MM hdi="y" fo="A" occ="1"><MC>A</MC></MM>'.repeat(30));
		expect(decodeRtr(many)).toBeUndefined();
	});
	it.each([undefined, null, 123, {}, new Uint8Array()])('rejects invalid public reader input %j', (value) => {
		expect(decodeRtr(value)).toBeUndefined();
	});
	it('returns independently owned typed and display fields', () => {
		const first = decode(input());
		first.fields[1].value = 'changed';
		expect(first.maintenance.fields[0].value).toBe('2026/10/10 09:11:49');
		first.maintenance.fields[0].value = 'other';
		expect(decodeRtr(xml).fields[0].value).toBe('2026/10/10 09:11:49');
	});
	it('interprets XML only after a complete MIAM body verifies, and separates envelope/application integrity', () => {
		const result = decode({ label: 'MA', text: miam() });
		expect(result.transfer.integrity).toBe('verified');
		expect(result.embedded).toMatchObject({
			title: 'Aircraft maintenance report RTR',
			coverage: 'partial',
			maintenance: { integrity: 'unverified', raw: xml },
		});
		expect(field(result.embedded, 'ITD 1 NFDE 1 description')).toBe('TEST REPORTED DESCRIPTION');
		expect(field(result, 'Embedded ITD 1 NFDE 1 description')).toBe('TEST REPORTED DESCRIPTION');
		expect(result.coverage).toBe('partial');
		expect(decode({ label: 'MA', text: miam(xml, { corrupt: true }) }).embedded).toBeUndefined();
		expect(decode({ label: 'MA', text: miam(xml, { encoding: 1 }) }).embedded).toBeUndefined();
		expect(decode({ label: 'MA', text: miam(xml, { app: 'H1DF' }) }).embedded.maintenance).toBeUndefined();
	});
	it('withholds embedded dispatch when supplied transfer integrity is unverified', () => {
		const result = {
			transfer: { text: xml, encoding: 0, applicationType: 1, application: 'H1CF', integrity: 'unverified' },
		};
		let called = false;
		interpretMiamEmbedded(result, {}, () => {
			called = true;
		});
		expect(called).toBe(false);
	});
	it('assembles three CF blocks before parsing XML and retains originals', () => {
		const common = { label: 'H1', registration: 'B-1234', direction: 'downlink' };
		const pieces = [xml.slice(0, 200), xml.slice(200, 400), xml.slice(400)];
		const records = pieces.map((text, i) => ({
			...common,
			id: i + 1,
			receivedAt: 1000 + i,
			messageNumber: `D01${'ABC'[i]}`,
			text: '#CFB' + text,
			continuation: i < 2,
		}));
		const result = decodeLog(records);
		expect(result.slice(0, 2).every((m) => !m.interpretation.maintenance)).toBe(true);
		expect(result[2].interpretation.maintenance.raw).toBe(xml);
		expect(result.map((m) => m.text)).toEqual(records.map((m) => m.text));
	});
	it('assembles compressed MIAM across three blocks, withholds when a middle block is missing', () => {
		const text = miam();
		const splits = [0, 200, 400, text.length];
		const records = [0, 1, 2].map((i) => ({
			label: 'MA',
			registration: 'B-1234',
			direction: 'downlink',
			id: i + 1,
			receivedAt: 1000 + i,
			messageNumber: `U01${'ABC'[i]}`,
			continuation: i < 2,
			text: text.slice(splits[i], splits[i + 1]),
		}));
		const result = decodeLog(records);
		expect(result[2].interpretation.embedded.maintenance.raw).toBe(xml);
		expect(result.slice(0, 2).every((m) => !m.interpretation.embedded)).toBe(true);
		expect(decodeLog([records[0], records[2]])[1].interpretation.embedded).toBeUndefined();
	});
});
