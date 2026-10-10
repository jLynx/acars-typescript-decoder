# Upstream coverage audit — 10 October 2026

This repository does not yet cover the union of the major public aviation
datalink decoders. It combines substantial application coverage, but important
protocols, transfer lifecycles and verification infrastructure are missing.
This audit inspected source, public fixtures and repository documentation. It
is a targeted comparison, not an exhaustive inventory of every public repository
or a measured claim that one implementation outperforms another.

## Implementation ledger

The original audit below describes the repository before this implementation
batch. The current [coverage table](coverage.md) is the authoritative capability
summary. Completed portions of the audited work are now implemented locally:

- Static Airframes assertion migration, Rust JSON fixture import, revision/hash
  verification, public dispatcher comparison and a reproducible local benchmark.
- FANS rates/fuel/souls, constructed positions/tracks, holding legs, predeparture
  and all six additional route structures; corrected magnetic/true degree ordering.
- AFN and TI2/OC1 text fields, with application integrity explicitly unverified.
- 11 October priority 1: FANS ADS-C request-group ordering, optional structural
  parsing without invented intervals, signed vertical-threshold comparisons,
  NACK reason/extensions, DIS high-nibble reasons and flight-ID validation.
  Interval-less periodic requests stay partial: pinned libacars retains them
  structurally, while datalink rejects them. Forty-eight independent synthetic
  regressions cover values, boundaries, CRC gating and H1 assembly. This does
  not complete every FANS variant or provide T5/T6 measurement definitions.
- MIAM negotiation/CF controls/files and verified embedded dispatch, including H1.
- OHMA conversation assembly, conflict rejection and bounded source sessions.
- Uplink radio assembly, structured statuses and snapshots for late completions.
- Receiver JSON adapters, a packaged replay CLI, AVLC/XID and X.25/CLNP/COTP/IDRP
  header readers; HFDL SPDU/MPDU/LPDU and supported network reports.
- Bounded X.25 M-bit reassembly, uncompressed CLNP checksum/address/segmentation
  headers and ES-IS common/ISH/redirect fields, with unknown ESH address lists retained.
- Uncompressed CLNP offset reassembly with bounded lifetimes/state, identical
  overlap/retransmission handling, conflict rejection and complete COTP/IDRP dispatch.
  Independent RFC 994 wire fixtures cover gaps, isolation, expiry and X.25 composition.
- ISO 8073 COTP checksum verification from RFC 905, including LI/header/user data
  and separate checks for concatenated TPDUs; ATN application checksums remain raw.
- Passive class-4 COTP DT/TSDU reassembly with explicit connection boundaries,
  normal/extended numbering, bounded resequencing, EOT, retransmission conflict
  rejection and message/idle expiry. This is a receive-side assembler, not a
  connection negotiation engine or ATN application decoder.
- Negotiated passive COTP ED delivery with independent sequence/history state,
  size/EOT checks, and matching-reference DR/DC closure that releases both services.
  Explicit session dependency ordering and EA tracking are described below;
  broader inference from incomplete captures remains pending.
- Passive bidirectional class-4 CR/CC matching from RFC 905, with normal/extended
  format, TPDU-size/expedited selection, initial credits, selector echoes, connection
  generations and bounded reference quarantine. Assemblies report their generation
  and direction; release/rejection/expiry closes both streams. Unsupported options,
  class fallback remains pending; checksum omission, selective ACK and tracked
  credit updates are now implemented as described in the current coverage table.
- Modern ESH source NSAP lists and the ISH configuration timer, adapted from
  pinned NetBSD ES-IS under its BSD-3-Clause and IBM notices; explicit legacy/raw
  ESH modes avoid layout guessing.
- Public dispatcher display comparisons for all runnable Airframes fixtures,
  including nested/renamed values, JSON equality and documented integrity refusals.
- Public corpus fixes for POS dispatch, fault/warning whitespace, A350 embedded
  headers and preserved flight-code leading zeroes.
- CRC-verified downlink CC1 bodies now reach the FANS decoder, including dM73
  version-number output. A public control fixture plus schema-boundary checks
  cover the previously omitted dispatch path; wrapper recognition was insufficient.
- Independently observed AER9/HEG9/KER9 and T5/TOF header variants, APU1 routes,
  configuration-only Airbus parts and PR identifier/value records; sanitized
  regression fixtures preserve raw numeric meanings and incomplete sequences.
- Observed H1/CF RTR XML fields through complete MIAM embedded dispatch and direct
  downlinks: bounded XML parsing, typed paths, repeated records, transmitted
  descriptions and unknown raw data. Proprietary flag/code semantics remain partial.
- RFC 905 duplicate COTP parameter last-occurrence rules, raw TLV preservation,
  effective checksum-length validation and normalized retransmission comparison.
- X.224 (11/1995) preferred maximum TPDU size negotiation, independently implemented
  from §§6.5.4/6.5.5 k), 13.1 and 13.3.4 c): unsigned big-endian 128-byte units,
  preferred selection or ordinary fallback, CC exclusivity and effective duplicates.
  Large selected values remain visible; configurable NSDU processing now supports
  up to 65535 bytes without overriding negotiated sizes or assembly limits.
- COTP acknowledgement/inactivity declarations and ROA selection, passive AK/FCC
  directional window tracking and DT window observations. ACKs explicitly report
  missing capture data and cannot advance receive assembly.
- EA matches the outstanding observed ED per direction; non-blocking ED dependencies
  hold normal delivery until the referenced expedited payload is delivered, with
  bounded state, wraparound, retransmissions and expiry.
- DR/DC lifecycle evidence continues through frozen records: matching confirmations,
  crossed requests, pending-CR refusal/cancellation and duplicate controls. Raw
  reason/data remain available; no active packets or inferred missing responses.

The current priority 2 pass also implements compressed CLNP contexts/offsets,
X.233 options, IDRP bodies/RD_PATH and ATN security tags, QoS/selective ACK/ISO
omission, ER lifecycle evidence, retained ATN checksum/address profiles, HFDL
system tables, demodulated Aero assembly/control/satellite ACARS and JAERO dialects.
Synthetic regression fixtures cover malformed inputs, integrity, conflicts and
state boundaries. Remaining edition/specification gaps stay unchecked in the roadmap.

Next work remains: complete upstream utilities/subclass tests and field-level
typed differential comparisons; audit every FANS body against schema; ATS CRCs;
Mobile SNDCF edition/circuit-group/Deflate audit, complete COTP flow and class
fallback, missing-capture inference and further ES-IS/XID/IDRP authentication/options;
independent ATN transport checksum verification and ATN B1/B2 CPDLC/CM/ADS-C;
further Aero variants and HFDL SPDU slots; incremental sessions and richer lifecycle
events; sustained fuzzing; licensed aircraft measurement dictionaries. Translation
of every public repository has not been completed.
Later capture audits still require encoded T5/TOF/T6 body decoding, application
part rules and verified aircraft dictionaries. Header/record recognition now exists
for the observed layouts; [capture-formats.md](capture-formats.md) describes its
scope. The implementation ledger does not claim their measurement decoding.
The [completion roadmap](completion-roadmap.md) defines the remaining work and
the evidence required before claiming comprehensive coverage or a ranking.

## Original confirmed gaps and suggested order

| Priority | Work                                                      | Evidence and current limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Source to compare or port                                                                                       |
| -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1        | Complete upstream fixture migration and field comparisons | The Airframes corpus here has 79 representative examples. The inspected upstream tree has 87 plugin test files and 101 test files overall, often with multiple examples and expected fields. Current corpus checks mostly establish a match and some extracted fields; they do not migrate all upstream assertions.                                                                                                                                                                                                                                   | Airframes tests; datalink payload, extraction, ADS-C, CPDLC and multiblock fixtures; libacars reference outputs |
| 1        | FANS CPDLC parameter and compound-body coverage           | The catalogue has 183 uplink and 129 downlink entries, but having a phrase does not mean its parameter body is decoded. The explicit supported-body sets contain 105 uplink and 49 downlink IDs. Additional parameterized entries fall back to templates; these counts exclude the distinction between parameter-free, reserved and deleted entries. Missing examples include predeparture clearance, holding leg types, vertical rates, fuel/souls, heading and speed requests. Additional route information and several route choices are rejected. | libacars FANS ASN.1 types and formatters; datalink CPDLC implementations and fixtures                           |
| 1        | AFN logon/contact/application notification                | A real upstream AFN contact fixture currently returns only label-category recognition with unknown coverage. There is no dedicated AFN parser or application checksum verification.                                                                                                                                                                                                                                                                                                                                                                   | datalink `arinc622/afn.rs`, its inline test and protocol references                                             |
| 1        | Structured ARINC 623 ATIS and oceanic clearance           | `/EHAM.TI2/000EHAMA0E3C` on B9 currently remains unknown. An upstream OC1 oceanic request is retained as generic B6 text instead of structured clearance fields. Existing Airframes H1 ATIS and airport-only 5D support does not establish complete ARINC 623 support.                                                                                                                                                                                                                                                                                | datalink `arinc623/atis.rs` and `arinc622/oceanic.rs`; Airframes ATIS readers                                   |
| 2        | Complete MIAM transfer lifecycle                          | The implementation handles single-transfer T frames and CORE v1/v2 data/acknowledgements. It lacks file request F, accept K, segments S, abort A, pause Y, resume X, CORE ALO/ALR negotiation and file reassembly. A verified embedded body is exposed as text/hex without dispatching into its application decoder.                                                                                                                                                                                                                                  | libacars `miam.c` and `miam-core.c`                                                                             |
| 2        | OHMA conversation reassembly                              | Generic ACARS block assembly exists, but the OHMA reader rejects outer JSON where numeric `msg_total > 1`. There is no conversation assembly using aircraft, `convo_id`, `msg_seq` and `msg_total`. libacars implements this separately from ACARS blocks.                                                                                                                                                                                                                                                                                            | libacars `ohma.c`; datalink Boeing OHMA examples                                                                |
| 2        | Stateful streaming and uplink reassembly                  | `decodeLog` requires callers to resubmit a retained source batch. Assembly only accepts downlinks with four-character message numbers ending in A–Z. No persistent session API or supported uplink assembly exists. Incomplete starts do not receive a structured pending/missing-block status.                                                                                                                                                                                                                                                       | libacars ACARS/reassembly implementation; datalink multiblock tests                                             |
| 3        | ATN CPDLC, context management and ADS-C v2                | There are no ATN ASN.1 application readers or ATN transport input types. These are distinct from FANS ACARS payloads. datalink has an implemented, feature-gated ATN B1 CPDLC reader and fixtures; its CM and ADS-C modules are placeholders. dumpvdl2 documents implemented ATN B1/B2 CPDLC, CM and B2 ADS-C v2.                                                                                                                                                                                                                                     | datalink ATN CPDLC/ULCS plus `rasn-atn-cpdlc`; dumpvdl2 ASN.1/schema references, subject to licensing           |
| 3        | Transport decoding and receiver integration               | The library starts at normalized application inputs or demodulated classic ACARS bits. VDL2 AVLC/XID, X.25/CLNP/COTP, HFDL SPDU/MPDU/LPDU, SATCOM Aero and audio/IQ demodulation are absent. A broad one-stop product also needs import adapters for receiver outputs and a replay CLI.                                                                                                                                                                                                                                                               | datalink transport/DSP modules; JAERO Aero; dumpvdl2, dumphfdl, acarsdec and vdlm2dec                           |
| Ongoing  | Airline/aircraft report dictionaries                      | Airbus/Boeing DF/ACM/APM/KER headers and selected explicit named measurements are recognized, but most proprietary report columns remain unverified. Existing public code often also stops at headers or classifications. No inspected source establishes universal measurement coverage.                                                                                                                                                                                                                                                             | Licensed aircraft/report specifications, independently validated examples and public airline parsers            |

The ordinary FANS ADS-C tag families are comparatively mature: the current
downlink tag set corresponds to the inspected libacars tag list, and the major
uplink contract/group families are present. Field semantics, control bodies,
unknown variants and rejection reasons still need differential verification.
ATN ADS-C v2 is a separate implementation gap.

## Correctness issue discovered during this audit

The recently added generic POS reader intercepted the documented Airframes
twelve-column POS format and returned raw fields instead of the available
position and altitude. Dispatch now prefers the validated community result
after recognizing the POS layout, falling back to the generic partial reader
for unsupported layouts such as the seven-column captured example. A regression
uses Airframes' independent expected position `38.850 N, 78.410 W` and altitude
`22290 feet`. This demonstrates why field-level comparisons matter more than
checking only that coverage is partial or that some fields exist.

## Infrastructure needed to substantiate broad coverage

- A versioned upstream manifest recording repository URL, exact commit, files,
  original license, attribution, fixture provenance and migration status. Current
  source notes and notices are useful but do not provide a complete port inventory.
- A reproducible comparison harness that runs pinned upstream decoders against
  the same public corpus and compares typed values, units, direction, checksums,
  unsupported fields and assembly results. Presentation differences should not
  count as semantic errors. A permissive upstream accepting damaged data should
  not be treated as the correctness oracle.
- Complete upstream assertions, boundary fixtures, property tests and fuzzing
  for binary parsing, framing, compression, retransmissions and state expiry.
  Benchmarks should measure throughput, memory and retained state on realistic
  streams. Current ordinary unit tests are not evidence of a fuzzing campaign
  or a comparative performance baseline.
- A typed protocol result alongside the current string-based display fields:
  numeric values and units, nested elements, raw byte/text spans, integrity status,
  decoder provenance, unconsumed data and assembly status. Keep the friendly
  summaries as an adapter over that result. Plugins currently return the first
  matching interpretation; future format arbitration should avoid broad readers
  obscuring more specific, validated decoders.
- A persistent source-aware session API with bounded state and explicit pending,
  complete, duplicate, failed and expired assemblies. Support receiver metadata
  and source identity without requiring a growing batch for each new block.
- Receiver JSON/JSONL adapters, a replay CLI, browser/worker examples and separate
  transport entry points. Application decoding can stay dependency-light while
  optional transport modules provide broader inputs.

Measure progress per format and fixture: fully decoded, partially decoded,
unsupported, malformed/rejected and semantically incorrect. Test count, recognized
label count and the number of copied files do not measure decoding completeness.
An accurate goal is to match or improve every supported semantic result in the
reviewed public corpus, while retaining explicit integrity and unknown-data rules.

## Sources inspected

| Repository                                                                                      | Inspected revision                                                  | Relevant source                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [szpajder/libacars](https://github.com/szpajder/libacars)                                       | `9af09a0121d4ec577339cbd4c7420d7519da48fa`                          | [FANS types](https://github.com/szpajder/libacars/tree/9af09a0121d4ec577339cbd4c7420d7519da48fa/libacars/asn1), [MIAM](https://github.com/szpajder/libacars/blob/9af09a0121d4ec577339cbd4c7420d7519da48fa/libacars/miam.c), [OHMA](https://github.com/szpajder/libacars/blob/9af09a0121d4ec577339cbd4c7420d7519da48fa/libacars/ohma.c) |
| [xoolive/datalink](https://github.com/xoolive/datalink)                                         | `d3e3e5a5d2bda04fbee83832cb77e3050a87364c`                          | [Payload readers](https://github.com/xoolive/datalink/tree/d3e3e5a5d2bda04fbee83832cb77e3050a87364c/crates/acars/src/decode/payload), [tests](https://github.com/xoolive/datalink/tree/d3e3e5a5d2bda04fbee83832cb77e3050a87364c/crates/acars/tests)                                                                                    |
| [airframesio/acars-decoder-typescript](https://github.com/airframesio/acars-decoder-typescript) | `51c912e75deb211403fe2f984fdefa1114766dce`                          | [Plugins and tests](https://github.com/airframesio/acars-decoder-typescript/tree/51c912e75deb211403fe2f984fdefa1114766dce/lib/plugins)                                                                                                                                                                                                 |
| [szpajder/dumpvdl2](https://github.com/szpajder/dumpvdl2)                                       | `686e87f2294ef6275855ba7364bd4bb9a0f8f56a`                          | [Supported protocols](https://github.com/szpajder/dumpvdl2/blob/686e87f2294ef6275855ba7364bd4bb9a0f8f56a/README.md#supported-protocols), [ASN.1 types](https://github.com/szpajder/dumpvdl2/tree/686e87f2294ef6275855ba7364bd4bb9a0f8f56a/src/asn1)                                                                                    |
| [jontio/JAERO](https://github.com/jontio/JAERO)                                                 | `1d4e515921244aec1d85a03f5f38b4e7818fdbe6`                          | [Aero support](https://github.com/jontio/JAERO/blob/1d4e515921244aec1d85a03f5f38b4e7818fdbe6/README.md), ARINC parser and test inventory                                                                                                                                                                                               |
| [ckuethe/skyshark](https://github.com/ckuethe/skyshark)                                         | Existing pinned revision `3d66e7d27ce5b9616643faa8a3b29ca9801b9007` | Python layouts and label catalogue already partly incorporated                                                                                                                                                                                                                                                                         |

Repository searches also located additional Go, Python, Rust and C++ projects.
Many primarily provide demodulation, wrappers or receiver viewers; some lack
an identified license. They require file-level review before they can be called
new application-decoder sources. This audit did not port or execute their code.

## Priority 1 weather and envelope audit (11 October 2026)

Python-Metar revision `281fb19e4f8870074844cba5e4b390a1f5fe7c6e` supplies core
METAR token layouts and named scales. Its LICENSE contains a BSD redistribution
notice with one condition; the source header calls it BSD-2-Clause. The full exact
notice is retained rather than silently treating those texts as identical. The port
requires explicit wind units and validates clocks; missing/unknown values and trend
or remark suffixes are retained. Independent tests verify values through public APIs,
SA bundles and radio assembly.

Pinned Wireshark Doc9705 Ed2 ULCS definitions establish one extensible presentation
list with context IDs 1..127 and excluded transfer-syntax/encoding alternatives.
The Rust adapter represents the list's leading extension bit as an optional spare
and tries both CPDLC directions without protected integrity verification. The new
reader follows the ASN.1 definition, retains extensions and requires explicit mode;
it does not adopt application inference or claim protected-message coverage.

The FANS schema audit confirmed procedure lengths 1..6 and transition lengths 1..5.
The older reader permitted up to eight characters. Those unused codepoints are now
rejected and malformed instructions remain partial even with a verified CRC. Speed
constraints cover all eight alternatives; all representable speed codepoints happen
to be valid in this schema, so there are no fabricated unused speed-value tests.

The data-only extractor `scripts/upstream/fans-schema.py` reads 213 pinned libacars
FANS C descriptors without executing upstream code. A bounded local UPER reader
preserves constrained values, optional members, aliases, enum/choice names and bit
spans. Conformance fixtures exercise every descriptor and CHOICE, primitive/list
boundaries, unused codepoints, optional combinations and truncated prefixes. They
share descriptor data and do not establish independent complete semantic equivalence.
Separate hand-packed examples check selected values, message structure and CRC gating.
This audit found FANSFrequencyDeparture directly aliases FANSFrequencyvhf; the old
predeparture reader and its synthetic fixture incorrectly inserted a frequency CHOICE.
That reader and fixture are corrected. Full display/semantic comparison remains open
in the correctness checklist.

The ULCS audit now includes the Doc9705 Ed2 ACSE kernel. Independent bit fixtures
check every root APDU, optional bitmap ordering, context/title OIDs, signed integer
qualifiers/invocations, five-bit release reasons, result/source diagnostics and
EXTERNAL payloads without byte padding. Unknown extensions and excluded title forms
remain raw; no application profile is selected from guessed direction. The pinned
protected CPDLC template describes coverage including aircraft address, flight ID
and ground facility, but provides no checksum implementation; application integrity
remains open rather than substituting a FANS CRC.

Pinned Wireshark atn-cm.asn defines CMMessageSetVersion1. The port reads all nine
direction-specific message choices, optional fields, fixed/constrained strings,
TSAP components, application lists, date/clock constraints and enum/extensions.
Independent tests include all 64 logon optional bitmaps, all response bitmaps,
list/version/address boundaries and truncated prefixes for every family. No
semantic aircraft address is inferred from a generic address-reference field.

The data-only `scripts/upstream/atn-schema.py` extractor reads 243 pinned Wireshark
CPDLC functions/tables without execution. The reader handles root constraints,
optional bitmaps, CHOICE/list/extensible enum values, strings and open types.
The extraction overrides the generated C display label for `*pdus_send`, whose
registered display name is incorrectly `startup`; the ASN.1 member is `send`.
Protected `AlgorithmIdentifier` is read as RELATIVE-OID per ASN.1 rather than
copying the generated callback, which performs no explicit decoding there.
Protected message bytes remain opaque; no guessed-direction or unverified
application measurement dispatch is copied from the upstream template.

Pinned dumpvdl2 generated C contributes data-only B2 CPDLC/ADS-C v2 member and
constraint tables. The extractor follows public roots, local anonymous types,
aliases, member-specific constraints and extension boundaries without execution.
ADS-C v2 application roots include ADSRequestContract, ADSReport, ADSAccept,
ADSReject, ADSNonCompliance and ADSPositiveAcknowledgement; PMADSC RequestType
is a cancellation enum and must not be selected as the contract request root.
The only omitted B2 generated type, AircraftIdentificationO, is not referenced
from these public roots. Default logical acknowledgement is explicit in typed
output when absent from the wire. Known extension payloads retain local spans and
raw bytes. X.691/asn1c open-type NULL occupies one zero octet; independent tests
fix the earlier zero-length fixture assumption. Protected bodies remain opaque.

Python-Metar supplementary/remark handlers now supply directional visibility,
recent weather, runway wind shear and selected numeric remark scales. This port
retains precise/period temperature values separately from the main observation;
it does not copy upstream overwriting or infer an ambiguous three/six-hour cycle.
Unsupported or duplicate remark tokens remain explicit. Existing pinned Airframes
H1/5Z TI2 fixtures now receive typed ATS results rather than display fields alone,
with strict layout/direction and unverified application integrity.
The display comparison explicitly records TI2's three-digit byte offset and
information-letter/four-hex-checksum boundary. Airframes combines the information
letter with the checksum in these fixtures; matching that five-character value
would discard the distinction. Prefix values remain raw with comparison evidence.
