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
- MIAM negotiation/CF controls/files and verified embedded dispatch, including H1.
- OHMA conversation assembly, conflict rejection and bounded source sessions.
- Uplink radio assembly, structured statuses and snapshots for late completions.
- Receiver JSON adapters, a packaged replay CLI, AVLC/XID and X.25/CLNP/COTP/IDRP
  header readers; HFDL SPDU/MPDU/LPDU and supported network reports.
- Bounded X.25 M-bit reassembly, uncompressed CLNP checksum/address/segmentation
  headers and ES-IS common/ISH/redirect fields, with unknown ESH address lists retained.
- Public dispatcher display comparisons for all runnable Airframes fixtures,
  including nested/renamed values, JSON equality and documented integrity refusals.
- Public corpus fixes for POS dispatch, fault/warning whitespace, A350 embedded
  headers and preserved flight-code leading zeroes.

Next work remains: complete upstream utilities/subclass tests and field-level
typed differential comparisons; audit every FANS body against schema; ATS CRCs;
CLNP/COTP fragment reassembly and ESH address lists; ATN B1/B2 CPDLC/CM/ADS-C;
SATCOM Aero; full HFDL system tables; incremental sessions and richer lifecycle
events; sustained fuzzing; licensed aircraft measurement dictionaries. Translation
of every public repository has not been completed.

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

## Licensing and migration approach

Public visibility is not permission to redistribute code or tests. Translating
C, Rust, Python or Go into TypeScript generally preserves the original code's
licensing obligations. Check individual files and bundled dependencies; a
repository-level label is only a starting point.

libacars, Airframes, datalink and Skyshark identify their main code as MIT and
are the strongest initial port sources. JAERO identifies its main code as MIT,
but its dependencies and individual bundled files still need review. dumpvdl2
and dumphfdl identify as GPL-3.0; vdlm2dec identifies as GPL-2.0. The inspected
acarsdec source header and README state GNU Library GPL version 2 despite its
GitHub license metadata being absent. Several small Go/Python projects have no
identified license.

Do not put GPL-derived translations into the existing MIT distribution as
MIT-only code. Options include obtaining compatible permission, choosing a
permissive implementation, writing an independent implementation from usable
specifications, or distributing a separate component under compatible terms.
The language conversion alone does not change this constraint. Tests and
captured fixture data need their own provenance review.

Port upstream tests first, retain their expected semantics, then migrate a
bounded feature and compare results before expanding coverage. Source errors
should be captured as explicit divergences and regression cases rather than
copied into the new decoder.

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
