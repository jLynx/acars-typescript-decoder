# acars-typescript-decoder

[![npm version](https://img.shields.io/npm/v/%40jlynx_%2Facars-decoder?logo=npm)](https://www.npmjs.com/package/@jlynx_/acars-decoder)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)
[![CI](https://github.com/jLynx/acars-typescript-decoder/actions/workflows/ci.yml/badge.svg)](https://github.com/jLynx/acars-typescript-decoder/actions/workflows/ci.yml)
[![Contributors](https://img.shields.io/github/contributors/jLynx/acars-typescript-decoder)](https://github.com/jLynx/acars-typescript-decoder/graphs/contributors)
[![Activity](https://img.shields.io/github/commit-activity/m/jLynx/acars-typescript-decoder)](https://github.com/jLynx/acars-typescript-decoder/pulse)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20%7C%2024%2B-339933?logo=nodedotjs&logoColor=white)](#nodejs-support-policy)

ACARS (Aircraft Communications Addressing and Reporting System) carries messages
between aircraft and ground stations worldwide. **@jlynx\_/acars-decoder** turns supported
payloads into readable summaries and fields, reassembles consecutive message blocks
and reads ARINC 618 frames.

Written in TypeScript for JavaScript and TypeScript applications, the library runs
locally in Node.js and browsers. It combines documented airline formats, binary
ADS-C/FANS CPDLC readers, MIAM CORE/file transfers and Boeing OHMA/RYKO conversations,
ATS text and VDL2/HFDL/Aero transport readers. Original messages are preserved, and results distinguish decoded, partial
and unknown payloads.

The project builds on research and implementations from
[Airframes](https://github.com/airframesio/acars-decoder-typescript),
[libacars](https://github.com/szpajder/libacars),
[datalink](https://github.com/xoolive/datalink) and
[Skyshark](https://github.com/ckuethe/skyshark). See the
[coverage and source references](docs/coverage.md) for supported formats and gaps.
A recognized label or report header does not imply its measurements are decoded.

Contributions are welcome. The combined package is distributed under
[GPL-3.0-or-later](LICENSE), following incorporation of dumphfdl, dumpvdl2 and Wireshark transport code.
Existing MIT notices remain applicable to their original files and dependencies.
The repository is [**acars-typescript-decoder**](https://github.com/jLynx/acars-typescript-decoder); the npm package name is
**@jlynx\_/acars-decoder**, available on [npm](https://www.npmjs.com/package/@jlynx_/acars-decoder).

## Node.js support policy

- Runtime: Node.js 22.x starting at 22.13.0, or Node.js 24 and later.
- CI configuration: Node.js 22.x, 24.x and 26.x on Linux, with Python 3.14 for generator tests.
- Distribution: ESM targeting ES2022, with bundled TypeScript declarations and source maps.
- Browser support: modern browsers providing ES2022 and standard Web APIs. Runtime decoding uses no Node-only APIs or network requests.
- Node type definitions are a development dependency and do not force consumers to install a particular `@types/node` version.

Development type-checking and consumer checks use stable TypeScript 7.0.2 (`tsc`).
ESLint and declaration bundling still require the TypeScript 6 compiler API. The
package follows Microsoft's [side-by-side installation guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0):
`@typescript/native` aliases TypeScript 7, while `typescript` aliases the official
`@typescript/typescript6` compatibility package. This preserves type-aware linting;
both compilers are development dependencies and are absent from consumer installs.

## Installation

Install from npm:

```sh
npm install @jlynx_/acars-decoder
```

It is a separate package from the MIT-licensed `@airframes/acars-decoder` dependency.

## Usage

### Decode a message

```ts
import { decode } from '@jlynx_/acars-decoder';

const result = decode({
	label: '3L',
	text: 'S 37.306/E174.100 /UTC 0809',
	receivedAt: Date.now(),
});

console.log(result.title, result.coverage, result.fields);
```

`label` and `text` are required. Direction defaults to `downlink`. Reception time
defaults to the current time; provide the actual timestamp when interpreting
time-only reports. Omitted dates may be inferred from reception and are identified
in the interpretation. Field values are display strings; units are included when
the format defines them.

### Reassemble a source log

```ts
import { decodeLog, type AcarsRecord } from '@jlynx_/acars-decoder';

const blocks: AcarsRecord[] = []; // complete received envelopes from ONE source
const messages = decodeLog(blocks);
```

Each record needs a unique positive `id`, millisecond `receivedAt`, registration,
mode, acknowledgement, label, block ID, direction, text and ETB `continuation` flag.
Provide `messageNumber` and `flight` when received. Call separately for independent
channels/sources. Results are chronological copies; original `text` is preserved
and the final block receives `assembledText` after consecutive downlink A–Z message
suffixes or uplink A–X link blocks and final ETX arrive. Missing blocks never get silently filled.

Batches allow up to 10,000 records, individual/assembled payloads up to 8,192
characters, and assemblies up to 26 blocks. Reassembly permits two minutes between
blocks and five minutes overall. Calls do not retain pending messages: pass the
retained source log again as new blocks arrive. The library does not truncate logs
to a viewer-specific count.

### Receive a stream or replay a capture

```ts
import { createDecoderSession, adaptReceiverRecord } from '@jlynx_/acars-decoder';

const session = createDecoderSession();
const received = adaptReceiverRecord({ label: 'Q0', text: '', timestamp: 1791576000 });
if (received) {
	const record = session.push(received.message, received.source);
	console.log(record.interpretation, record.assemblies);
}
const sourceWindow = session.snapshot();
```

Sessions retain bounded source windows: by default 16 sources, 512 records and
1 MiB of text per source for twenty minutes. `push` returns the arriving record;
`snapshot(source)` retrieves earlier records completed by late arrivals. Windows
are reinterpreted per push, so this API currently favors consistency over
incremental processing speed. `reset` clears state and `stats` reports retained
records and evictions. Independent source identities stay isolated.

Receiver adapters accept flat acarsdec/vdlm2dec and nested dumpvdl2/dumphfdl JSON,
preserve the original receiver object, and keep receiver error counts separate
from locally verified integrity. Stripped H1 metadata is reconstructed for dispatch.

```sh
acars-decode messages.jsonl
acars-decode --capture capture.json
```

The installed Node CLI also reads JSONL from stdin and writes interpreted JSONL.
Capture mode accepts the grouped `sources[].messages` viewer export. Radio block,
MIAM file and OHMA conversation assemblies have structured status metadata.

Complete H1/CF RTR XML maintenance reports also expose explicit aircraft, route,
CMS and transfer identifiers, transmitted NFDE/MM descriptions/codes and system
attributes. `decodeRtr(text)` is exported from the main and `/formats` entry points;
its typed fields preserve XML paths, raw values and the original document.
CRC-verified MIAM carries these results in `embedded.maintenance` and displays
the extracted fields alongside the original application text. Proprietary flags,
date/timezones and status meanings remain raw; reported descriptions are not
inferred diagnoses. Coverage is partial until a matching schema and code mappings
are verified. See [observed report support](docs/capture-formats.md).

### Optional airport names

```ts
import { createDecoder } from '@jlynx_/acars-decoder';
import { airportName } from '@jlynx_/acars-decoder/airports';

const decoder = createDecoder({ airportLookup: airportName });
const atis = decoder.decode({ label: '5D', text: 'NZAA' });
```

The optional offline OurAirports snapshot contains 11,764 airports. The main entry
does not import it. You can supply your own lookup returning a name or `undefined`;
unknown codes remain visible. Only explicitly identified airport fields are enriched.

### Custom formats

```ts
import { createDecoder, type AcarsPlugin } from '@jlynx_/acars-decoder';

const plugin: AcarsPlugin = {
	name: 'my-airline',
	decode(message) {
		if (message.label !== 'ZZ' || message.text !== 'HELLO') return undefined;
		return {
			title: 'Greeting',
			summary: 'Hello received.',
			coverage: 'decoded',
			fields: [],
			notes: [],
		};
	},
};

const decoder = createDecoder({ plugins: [plugin] });
```

Plugins run in caller order before built-in results, receive frozen envelope copies
and must return the documented interpretation shape. Exceptions and malformed
results fall through. For logs, plugins receive assembled text where available;
original envelopes and assembly notes remain preserved. Plugins are synchronous.

### Framing and lower-level readers

Use `@jlynx_/acars-decoder/framing` to load transport readers without application decoders.
`AcarsFramer.bit()` accepts demodulated bits, validates parity and block CRC, then
calls your callback with parity-bearing bytes. `decodeFrame()` interprets those
validated bytes, excluding the BCS. `decodeFrame()` alone checks parity/layout;
it cannot verify a BCS that is absent.

`decodeAvlc` accepts destuffed VDL2 bytes including FCS. `decodeXid`, `decodeX25`,
`decodeClnpCompressed`, `decodeClnp`, `decodeEsis`, `decodeCotp` and `decodeIdrp` expose transport headers and
raw unknown data. COTP verifies the ISO 8073 checksum over each complete TPDU;
user data remains raw and ATN application integrity remains unverified. Ambiguous normal
versus extended sequence formats require the caller's negotiated `format` option.
Uncompressed CLNP verifies its header checksum before inner transport dispatch.
ES-IS exposes common/ISH/redirect fields, counted ESH source NSAPs and the ISH
end-system configuration timer in seconds. Addresses remain byte arrays.
For older ESH layouts select `decodeEsis(bytes, { eshFormat: 'legacy-single' })`;
`eshFormat: 'raw'` retains an uninterpreted ESH region. Malformed counted lists
are rejected rather than interpreted as a different layout.

`createX25Reassembler()` joins consecutive modulo-8 packets before network decoding.
Supply a `link` identity containing receiver, peers and direction, plus reception time.
It bounds channel state, bytes, fragments and lifetime, suppresses retransmissions,
and rejects conflicting sequences until expiry or `reset(link)`. Link CRC verification
must occur before calling it. ATN applications remain pending.

```ts
import { createX25Reassembler } from '@jlynx_/acars-decoder/framing';

const network = createX25Reassembler({ maxChannels: 64, retentionMs: 60_000 });
const result = network.push(verifiedX25Bytes, {
	link: 'receiver-1:aircraft-ABC123:ground-01:downlink',
	receivedAt: Date.now(),
});
if (result.status === 'complete') console.log(result.network ?? result.clnp ?? result.esis);
```

`createClnpReassembler()` joins uncompressed CLNP segment offsets, including
out-of-order offsets and byte-identical overlaps. Every accepted header must verify.
Conflicting bytes, total lengths or header options reject the message until expiry/reset.
State defaults to 64 messages, 8,192 payload bytes per message, 128 fragments and
sixty seconds, with expiry further bounded by the PDU's remaining lifetime.
Use a receiver/direction `link` scope; source/destination NSAPs and PDU IDs also
isolate messages. Completed output carries the original received `packet` and
separate assembled `payload`/`cotp`/`idrp`, without fabricating a wire header/checksum.

```ts
import { createClnpReassembler } from '@jlynx_/acars-decoder/framing';

const clnp = createClnpReassembler();
if (result.status === 'complete' && result.network) {
	const assembled = clnp.push(result.payload!, {
		link: 'receiver-1:downlink',
		receivedAt: Date.now(),
	});
	if (assembled.status === 'complete') console.log(assembled.cotp ?? assembled.idrp);
}
```

CLNP checksums protect headers only. COTP reports integrity per TPDU and in
aggregate; absent checksums or unparsed trailing bytes keep aggregate integrity
unverified. Address-bound ATN 16/32-bit COTP checksums have separate
`atnIntegrity` results when directed source/destination NSAPs are supplied through
`atnAddresses`. Sessions retain that scheme and reverse NSAPs for the opposite
direction; missing or changed protection is rejected. The pinned upstream's 16-bit
routine is marked untested; independent external verification remains outstanding.

`createClnpCompressedReassembler()` joins offsets with explicit local-reference
address contexts registered by `open(context, receivedAt)`, or by `observe()` on
a verified uncompressed CLNP option-5 setup. Reception requires a directed `link`,
`receivedAt` and `linkIntegrity: 'verified'`. Contexts retain priority, version,
security and both NSAPs; gaps/conflicts, expiry and bounds remain explicit.
Circuit-group negotiation and Deflate contexts still need an edition audit.

X.233 CLNP options expose typed routes, QoS/security and discard information.
IDRP exposes Open/Update/Error bodies, RD_PATH segments and ATN security labels
through `decodeAtnSecurityLabel`; authentication stays unverified. XID exposes
sequencing, refusal bytes, modulation masks, autotune frequencies, station lists
and nearest airports. Unknown encodings and timer units stay raw.

`createCotpReassembler()` provides passive class-4 DT/TSDU reassembly after the
network layer. Open each directional connection with its negotiated format and
a known message boundary. New connections begin at DT sequence zero; for an
existing connection supply the first expected sequence at a known TSDU boundary.
Sequence numbering continues between messages. The library waits for missing
in-window packets, handles sequence wraparound and retransmissions, and exposes
complete messages only after every TPDU in the received NSDU verifies.

```ts
import { createCotpReassembler } from '@jlynx_/acars-decoder/framing';

const cotp = createCotpReassembler();
cotp.open(
	{
		link: 'receiver-1:source-nsap:destination-nsap:connection-1:downlink',
		destinationReference: 0x1234,
		format: 'normal',
	},
	Date.now(),
);
const messages = cotp.push(completeNetworkUserData, {
	link: 'receiver-1:source-nsap:destination-nsap:connection-1:downlink',
	receivedAt: Date.now(),
});
for (const message of messages.assemblies) {
	if (message.status === 'complete') console.log(message.payload);
}
```

Defaults are 64 connections, 64 KiB pending bytes plus 64 KiB duplicate-history
bytes per connection, 128 pending fragments, a 32-sequence forward window and
sixty seconds for pending data/idle connections. History is also capped by the
window count. Conflicting retransmissions reject a connection until expiry,
`reset()` or a new `open()`. Expiry discards its known boundary; subsequent data
requires a new explicit `open()`. DT reassembly supports normal and extended
formats. For automatic passive negotiation, use `createCotpSession()` below.
Acknowledgement/flow controls and ATN application decoding remain caller
responsibilities. An explicit connection can declare `atnChecksum` and
`atnAddresses`; this retains and enforces its transport profile. Connections using
ISO checksum omission cannot produce assembled output through this explicit API.

For a connection with negotiated expedited service, include `expedited: {}` in
`open()` (or set its independent `startSequence` at a known ED boundary). ED
messages require EOT and 1–16 bytes. Output identifies `service: 'expedited'` or
`'normal'`; ED and DT numbering, pending data and duplicate history are separate.
ED pending/history storage is additionally bounded to 16 bytes times the sequence
window each. A conflict in either stream rejects both until reset/open/expiry.
This passive reader reports separate receive streams; EA tracking and ordering
between ED and DT deliveries remain unimplemented.

Declare the known peer `sourceReference` in `open()` to enable passive disconnect
handling. A checksum-verified DR/DC whose destination and peer references match
closes that directional state, releases both buffers, returns `status: 'closed'`
and adds its key to `discarded`. Mismatched/unassociated controls remain raw.
Release-response generation remains pending.

`createCotpSession()` matches captured class-4 CR/CC handshakes and automatically
opens both receive directions at sequence zero. Supply a common receiver/peer-pair
`link`, an explicit direction and ordered timestamps. Every TPDU must have a verified
ISO checksum unless both peers select omission; failed present checksums are
always rejected. Version, selectors, normal/extended format, size and expedited selection
are checked; unsupported negotiation parameters retain raw bytes and prevent opening.

```ts
import { createCotpSession } from '@jlynx_/acars-decoder/framing';

const transport = createCotpSession({ maxRecords: 64, freezeMs: 60_000 });
const received = transport.push(completeCotpNsdu, {
	link: 'receiver-1:aircraft-ABC123:ground-01',
	direction: 'a-to-b', // keep these peer labels consistent for the capture
	receivedAt: Date.now(),
});
for (const message of received.assemblies) {
	if (message.status === 'complete') console.log(message.connectionId, message.direction, message.payload);
}
```

Sessions report initial credits and track directional AK windows, subsequences,
credit reductions and matching flow-control confirmations. `acknowledgement`
events distinguish observed data from ACKs spanning missing capture data. DT
assemblies expose `transmission` with the advertised window and whether the DT
falls inside it; `windowSize` still controls local resequencing. EA events match
the outstanding observed ED. Non-blocking expedited negotiation holds a DT with
an ED-sequence dependency until that ED has been delivered, then releases complete
messages in order. Blocking-service DTs report a pending EA; their TS-user request
order cannot be inferred from packets alone. A matching release, reassembly
rejection or expiry closes both directions and quarantines the peer references.
Defaults are 64 total records and sixty-second handshake/pending/idle timeouts
and quarantine; `reset(link)` clears state at a known capture boundary. Connect
user data stays raw, separate from assembled DT/ED. X.224 preferred maximum TPDU
size negotiation supports one-to-four-byte unsigned values in multiples of 128
bytes, preferred selection and ordinary-size fallback. `tpduSize` reports the
actual negotiated value. Set `maxNsduBytes` on `decodeCotp`, `createCotpSession`
or `createCotpReassembler` to process larger NSDUs, up to a local maximum of 65535
bytes (default 8192). Negotiated sizes and assembly limits still apply.
`initiatorTiming`/`responderTiming` preserve acknowledgement and inactivity
indications in milliseconds independently of local capture expiry. ROA use must
be negotiated. Release events distinguish requested/confirmed/crossed DR/DC,
refusal, cancellation and unmatched DC, with raw reason codes/user data retained.
Sessions retain per-peer QoS/protection and negotiated selective ACK ranges,
including wraparound and cumulative trimming. Mutually selected ISO checksum
omission is explicit and does not waive failed present checksums. ER retains
reject cause/header evidence, releases a pending request and preserves an established
connection until an observed release. Class fallback, complete flow-control
procedures, broader missing-capture inference and ATN application integrity remain pending. See the [completion checklist](docs/completion-roadmap.md).

`decodeHfdl` accepts demodulated SPDU/MPDU bytes, verifies header and individual
LPDU CRCs, and exposes supported station, performance, frequency and embedded
ACARS data. `createHfdlSystemTableAssembler()` accepts complete verified frames,
assembles multipart station tables and selects versions per source with 12-bit
ordering. Tables expose signed coordinates, BCD frequencies and master-frame
slots; conflicts, expiry and resource bounds are explicit. SPDU slot allocations
and further documented variants remain raw.

`decodeAeroSignalUnit(bytes, channel)` accepts demodulated R (19-byte) or P/T
(12-byte) signal units including FCS. `createAeroReassembler()` assembles bounded
multipart ACARS with an explicit directed link and reception direction. Valid
satellite envelopes verify parity and BCS and preserve text without requiring a
VHF message-number/flight prefix. Control fields include C-channel assignments,
P/R bitrates and satellite/GES frequency broadcasts; remaining bodies stay raw.
Receiver adapters accept JAERO native/JSONdump records, including empty ACKs and
source-derived direction. IQ/audio demodulation and radio drivers remain outside
the implemented scope; further Aero channel variants require evidence.

`interpretArinc`, `decodeAdsc`, `decodeAdscDisconnect` and `decodeCpdlc` are exported
for protocol use. FANS ADS-C requests retain group wire order and compound-request
boundaries; a periodic request without an interval stays partial. Vertical-speed
thresholds retain their greater/less comparator. Rejection reasons name erroneous
octets/tags, and DIS reasons come from the high nibble with unknown bits preserved.
The public dispatcher verifies the ARINC CRC before exposing application values.
The lower-level DIS reader accepts one payload octet without the surrounding CRC.
`decodeFansCpdlcStructure(bytes, direction)` reads all 213 types in the pinned
FANS schema, including every uplink/downlink element choice, optional fields and
constrained values. Its typed tree retains raw bytes, choices and bit spans. Values
use the ASN.1 constrained representation; scaled measurement units still come from
the application decoder. Structural validity and zero padding do not verify integrity
or guarantee complete display interpretation. The public dispatcher exposes this tree
as `cpdlc` after a verified ARINC CRC; the standalone tree records integrity as
`unverified` because the caller supplies bytes without that envelope.
`decodeAtnAcse(bytes, bitLength?)` reads the Doc9705 Ed2 ACSE kernel and retains
context names, calling title/qualifier, result/diagnostics, release/abort fields,
EXTERNAL application bit strings and extensions. `decodeAtnUlcs` attaches it to
explicit context 1 values or connection application bytes. Excluded fields and
unsupported title forms remain raw with explicit profile/completeness status.
Association state, authentication and protected application integrity remain open.
`decodeAtnCm(bytes, direction, bitLength?)` reads CMMessageSetVersion1 aircraft and
ground messages, including logon/contact/update/forward/abort choices, advertised
applications/versions, long/short TSAP bytes and optional departure data. The caller
supplies a known direction and application context; raw bytes, exact bit length,
unknown extensions and calendar validity are retained. Application integrity is
unverified at this standalone layer.
`decodeAtnCpdlc(bytes, {direction, mode, bitLength?})` reads the pinned Doc9705
CPDLC version 1 plain message schema into typed choices, constrained values and bit
spans. Both direction and `plain`/`protected` mode must be supplied. Protected
message and checksum bits remain opaque pending aircraft/flight/facility-bound
integrity verification. Plain values retain wire representation with documented
`measurement` scales, units and references from the pinned ASN.1 comments.
Structural completeness does not establish complete semantic interpretation or
association validity.
`decodeAtnB2Structure(bytes, {application, direction, mode, message?, bitLength?})`
reads pinned B2 CPDLC and ADS-C v2 schema structures. `application` is `cpdlc` or
`adsc`, and `mode` is `application` or `protected`. ADS-C application mode also
requires its inner `message` type: `request`, `report`, `accept`, `reject`,
`noncompliance` or `positiveAcknowledgement`. Requests require uplink; the other
inner types require downlink. Known extension fields decode with raw open-type
bytes retained; their bit spans refer to their own open-type payload. Absent ASN.1
DEFAULT values are marked `defaulted` with zero bit length. Protected bodies stay
opaque and integrity is `unverified`; this explicit reader does not infer a schema
from conventional VHF ACARS labels or establish full application semantics.
METAR weather results also retain directional visibility, recent weather, runway
wind shear and selected numeric `remarks`: sea-level pressure, precise temperature,
period temperature extrema, precipitation, pressure tendency, snow depth and ice
accretion. Remark values keep their units/periods and do not overwrite body values;
unsupported remark tokens remain available. TI2 requests on documented H1/5Z
layouts expose typed airport, byte-offset and information-letter fields with
unverified application checksum status.
`@jlynx_/acars-decoder/formats` exposes lower-level readers that require normalized records;
they may throw on malformed binary data and do not provide input validation or
airport enrichment. Prefer `decode`/`decodeLog` for applications.

## Development

Use the latest stable Node.js 26 for development; supported older runtimes remain
in CI. Dependencies use stable releases, and Dependabot checks npm packages and
GitHub Actions weekly. Dependency updates must pass the same lint, type, decoder,
data and package checks before merging.

```sh
npm run check
npm test
npm run test:coverage
npm run test:data
npm run build
npm run test:package
npm run test:upstream
npm run benchmark
```

The upstream manifest pins revisions and licenses. Static importers retain
Airframes assertions and Rust JSON fixtures without executing downloaded tests;
`scripts/upstream/verify.mjs` checks their hashes against the pinned public files.
`npm run compare:upstream` classifies public-dispatch display differences using
nested fields, aliases, JSON equality and explicit refusal reasons. Full typed
semantic comparisons remain pending. Passing tests does not establish universal coverage.

## Contributions

New decoders, documented message formats, regression fixtures and improvements to
existing coverage are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the strict
lint rules, validation checks and requirements for licensed sources and tests.

The community [ACARS Message Documentation](https://github.com/airframesio/acars-message-documentation)
is a useful research reference. Include the source and expected field meanings
when adding a format, and preserve unknown data rather than assigning speculative
meanings or units. The [coverage guide](docs/coverage.md) lists areas for further work.

## Contributors

| Contributor                       | Description                    |
| --------------------------------- | ------------------------------ |
| [jLynx](https://github.com/jLynx) | Project creator and maintainer |

Upstream authors and data providers are credited in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and the
[source reference guide](docs/coverage.md).

## License

The combined package is licensed under **GPL-3.0-or-later**. See [LICENSE](LICENSE)
for the full terms; historical MIT terms are retained in [docs/MIT-LICENSE.txt](docs/MIT-LICENSE.txt). Upstream
components retain their required notices, and the optional OurAirports dataset
is public domain. Proprietary reports still require their specifications to decode.

Core METAR observations are available through `decodeMetar(text)` and the normal
RA/C1/H1 dispatcher (`result.weather`). Typed values retain units, visibility limits,
raw observations and unsupported trend/remark text. `decodeAtnUlcs(bytes, 'data')`
reads explicit ATN presentation envelopes; use `'connection'` for short connection
headers. ATN application payloads and integrity remain partial. See
[coverage](docs/coverage.md) for the precise implemented scopes.
