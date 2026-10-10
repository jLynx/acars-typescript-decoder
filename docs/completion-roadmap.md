# Completion checklist

Updated 11 October 2026: the current priority 1 weather/TI2 batch is finished;
remaining checklist work is paused at the user's request. Priority 2 remains
deferred with nine open checkboxes. Completed batches' full verification is
recorded below; resumed work receives its own verification before check-off.
Checked items describe their implemented scope, not complete coverage of a whole
protocol. Unchecked items
are still outstanding. The [coverage table](coverage.md) describes current support,
the [upstream manifest](upstreams.json) pins sources/licenses and the
[audit](upstream-audit.md) records earlier migration work.

There is no established percentage for “all ACARS,” and this project has not
inventoried every public repository. Proprietary applications need usable
specifications; encrypted data and missing captured blocks cannot be made readable
by copying public code. Define a finite release target by specifications, versions,
source revisions and fixtures. A “best” claim also needs published comparisons.

## Application support — priority 1

**Priority 1 progress: 15 of 26 checkboxes complete; 11 remain open.** The total includes narrow
verified scopes added beneath the original broader rows; those rows remain open
until their full requirements are met.

Resume order follows the BrowSDR review: encoded T5/T6, Airbus application parts,
measurement definitions and airline/weather variants, then the remaining ATS/FANS
and ATN applications. T5 is radio-complete in the supplied example; T6 lacks its
first radio block. The inspected public sources have not established their encoded
field dictionary or the Airbus cross-message part relationship. Those scopes remain
open while independently supported application work continues.

- [x] ATN Doc9705 Ed2 upper-layer short-session/presentation and ACSE kernel
      decoding with typed context identifiers, context/title OIDs, result/source
      diagnostics, release/abort fields, EXTERNAL application bit strings and bounded
      extensions. Excluded title forms/unknown fields retain raw bytes and explicit
      completeness/profile status. Live association state, authentication and
      protected application verification remain open; full package/capture checks pass.
- [ ] ATN B1 CPDLC application decoding using licensed schemas and known directions.
- [x] Pinned ATN CPDLC version 1 plain-message structure and protected wrappers:
      243 descriptors, explicit direction/mode, root elements, constrained values,
      optional bitmaps, raw extensions and bit spans. Protected content stays opaque
      pending aircraft/flight/facility-bound integrity. 1,166 new independent and
      descriptor-conformance regressions pass with full package/capture verification;
      complete scaled application meanings remain open above.
- [ ] ATN B2 CPDLC.
- [x] Pinned B2 CPDLC schema structure: all 424 uplink/182 downlink element
      alternatives, including known extension open types, optional/default fields,
      constraints and typed raw spans through explicit direction/application input.
      Protected wrappers retain opaque bytes; complete application semantics and
      protected integrity remain open above. Full package/capture verification passes.
- [x] ATN CMMessageSetVersion1 context-management messages: all aircraft/ground
      logon/contact/update/forward/abort choices, optional fields, advertised
      applications/versions, long/short TSAP bytes, date/clock constraints and raw
      extensions. Known direction required; 20 independent regressions include
      every optional bitmap, 256-entry boundaries and malformed/truncated bodies.
      CM live association procedures and integrity remain unverified.
- [ ] ATN ADS-C v2.
- [x] Pinned ADS-C v2 request/report/accept/reject/noncompliance/positive-acknowledgement
      schema structures, all 187 generated source types, member-specific constraints,
      root/known extension fields and opaque protected wrappers. Explicit inner message
      type and direction required. Full application measurements and protected integrity
      remain open above; full package/capture verification passes.
- [ ] ATN checksum and protected-message integrity verification before measurements.
- [ ] ATS text CRC verification using documented coverage/encoding rules and
      independently verified valid/corrupt examples.
- [ ] Further AFN/TI2/OC1 variants; distinguish weather tokens from checksums.
- [x] Documented H1/5Z TI2 request variants through typed public dispatch:
      airport, byte offset, information letter and raw checksum with explicit
      unverified integrity; wrong directions, airport mismatches, malformed and
      trailing data have regressions. Full package/capture verification passes.
- [x] Complete structural validation of all 213 types in the pinned FANS CPDLC
      schema: all 183 uplink/129 downlink element choices, constraints, aliases,
      optional members, string/list boundaries, unused codepoints and truncated
      bodies. Typed trees retain constrained wire values, raw bytes and bit spans;
      invalid schemas cannot be marked completely decoded. Independent semantic
      equivalence and reserved/deleted display meanings remain in the correctness
      checklist. All required checks and five supplied capture replays pass.
- [x] All pinned FANS ADS-C downlink report tag families with independent field/unit
      expectations: signed coordinates/altitudes, eighth-second time, all accuracy
      meanings, ground/Mach/vertical rates, weather, route/projection extrema,
      flight/airframe IDs and noncompliance odd/even lists. Nonzero unassigned
      status/padding bits remain raw and partial. Every supported downlink tag has
      truncated-prefix and corrupt-CRC tests; 46 new regressions and full required
      verification pass. ATN ADS-C v2 remains a separate open scope.
- [x] FANS ADS-C request-group wire-order parsing, reporting interval after other
      groups, compound request boundaries, signed vertical-threshold comparators,
      and interval-less requests retained as partial with no invented interval.
      Repeated/incompatible request groups and empty event requests retain fields
      while remaining partial; structural recognition does not imply validity.
- [x] FANS ADS-C NACK reason/extension semantics, DIS high-nibble reason decoding,
      raw unknown DIS fields, strict flight-ID alphabet and input bounds;
      48 regressions cover values, malformed boundaries, verified/corrupt CRCs
      and complete H1 radio assembly. Complete FANS coverage remains open above.
- [ ] Encoded T5/TOF and T6 aircraft report bodies.
- [ ] Airbus application-part assembly using verified identifiers and part rules,
      including any documented relationships across radio message numbers.
- [ ] Licensed Boeing/Airbus measurement dictionaries with explicit units/scales
      and independently checked expected values.
- [ ] Further airline/weather payload variants through the public dispatcher.
- [x] Core METAR observations through RA/C1/H1 and SA bundle dispatch: explicit
      wind units/gusts/variation, metric/fractional visibility and limits, runway
      visibility, clouds, weather, temperature/dew point and Q/A pressure; raw
      trends/remarks, malformed/duplicate groups and ETB status remain explicit.
      33 regressions and full package/capture verification pass.
- [x] Documented METAR directional visibility, recent weather, runway wind shear
      and selected numeric remarks with explicit units/periods: sea-level pressure,
      precise/period temperatures, precipitation, pressure tendency, snow and ice.
      Main observation values remain separate; unknown/duplicate remarks and
      ambiguous three/six-hour periods remain explicit. Thirty independent regressions
      and full package/capture verification pass; other weather variants remain open.
- [x] Explicit ATN ULCS short-session/presentation headers and bounded X.691
      Fully-encoded-data values with typed context IDs, OIDs, bit lengths, fragment
      determinants and raw excluded/extended fields (37 targeted regressions).
      ACSE/application bytes remain undecoded; full package verification passes.
- [x] FANS CPDLC procedure/transition length constraints, all eight speed alternatives
      and public reader input bounds; independently packed valid/invalid bodies
      and CRC-verified malformed instructions (17 regressions). Full schema coverage
      remains open above; full package verification passes.
- [x] Observed H1/CF RTR maintenance XML fields, including CRC-verified MIAM
      embedded dispatch, repeated records and typed paths with original XML retained.
- [ ] Complete RTR schema/version coverage and independently verified mappings
      for proprietary status/phase/class codes; the observed layout remains partial.

First priority 1 batch verification (11 October): all 2,179 JavaScript tests in
77 files, five Python data tests, lint/format/structure/type checks, production build
and packed-package Node/TypeScript/browser checks pass. All five supplied captures
replay through the API and CLI with preserved metadata/assembly and unchanged
coverage counts from the completed transport batch. The new 48 regressions verify
ADS-C application fields; they do not establish T5/T6 body coverage or decode the
remaining proprietary reports in those captures.

Weather/envelope batch verification (11 October): all 2,266 JavaScript tests in
80 files, five Python data tests, lint/format/structure/type checks, production
build and packed Node/NodeNext TypeScript/browser/CLI checks pass. Five supplied
captures replay with preserved originals and unchanged coverage totals. The new
87 tests cover core METAR, ULCS envelopes and FANS constraints; no T5/T6 measurement
coverage or ACSE/protected application coverage is claimed.

FANS schema batch verification (11 October): all 3,252 JavaScript tests, five Python
data tests, lint/format/structure/type checks, production build and packed
Node/NodeNext TypeScript/browser/CLI checks pass. The 986 additional tests include
hand-packed values/CRC examples and descriptor-based conformance matrices, which
are explicitly distinguished from independent semantic expectations. Five supplied
captures retain the previous 294 decoded / 74 partial / 119 unknown total.
The schema audit also fixes the predeparture VHF frequency's incorrect extra
CHOICE bits. T5/T6 and proprietary report body coverage remain open.

ADS-C report batch verification (11 October): all 3,298 JavaScript tests, five
Python data tests (unchanged), lint/format/structure/type checks, production build
and packed-package checks pass. Five supplied captures retain coverage totals.
The reader now names all eight navigation-accuracy codes and preserves nonzero
unassigned report bits instead of silently discarding them. The 46 new regressions
independently cover all supported downlink tag families and failure boundaries.

ACSE batch verification (11 October): all 3,322 JavaScript tests, five Python data
tests, lint/format/structure/type checks, production build and packed-package
Node/TypeScript/browser/CLI checks pass. The 24 new independent ACSE regressions
cover all root APDUs, excluded/extended fields, unpadded payloads, malformed
boundaries and explicit ULCS integration. Five supplied captures remain unchanged.

CM batch verification (11 October): all 3,342 JavaScript tests, five Python data
tests (unchanged), lint/format/structure/type checks, production build and packed
Node/TypeScript/browser/CLI checks pass. Five supplied captures retain prior coverage.
The earlier combined B2 CPDLC/context-management row is split into its two scopes,
increasing the total from 20 to 21; B2 CPDLC remains open.

ATN CPDLC structural batch verification (11 October): all 4,508 JavaScript tests,
five Python data tests (unchanged), lint/format/structure/type checks, production
build and packed Node/TypeScript/browser/CLI checks pass. Five supplied captures
retain prior coverage. The structural scope adds one narrow checkbox (total 22),
with B1 complete semantic decoding and protected integrity still open.

B2/ADS-C v2 structural batch verification (11 October): all 7,515 JavaScript tests
in 93 files, five Python data tests, lint/format/structure/type checks, production
build and packed Node/TypeScript/browser/CLI checks pass. The 2,961 additional
regressions distinguish data-sharing conformance from hand-packed expectations.
All five supplied captures retain the 294 decoded / 74 partial / 119 unknown totals.
Documented version 1 scalar annotations also have 46 independent expected-value
regressions. These explicit ATN APIs do not explain proprietary VHF report bodies.

Supplementary weather/TI2 batch verification (11 October): all 7,551 JavaScript
tests in 94 files, five Python data tests, lint/format/structure/type checks,
production build and packed Node/TypeScript/browser/CLI checks pass. Thirty
independent weather regressions and six TI2 variant/rejection regressions were
added. Five supplied captures replay with raw metadata preserved and unchanged
294 decoded / 74 partial / 119 unknown totals. Remaining work is paused at the
user's request after finishing this batch; unsupported proprietary bodies and
integrity verification stay open.

## Transport support — priority 2

- [x] Uncompressed CLNP offset reassembly, header checksums and bounded expiry.
- [x] COTP ISO 8073 full-TPDU checksum verification.
- [x] Passive class-4 COTP DT reassembly with caller-established boundaries,
      normal/extended sequences, EOT, bounded resequencing and retransmissions.
- [x] Negotiated COTP ED delivery with an independent sequence space, 1–16 byte
      messages, EOT, duplicate/conflict handling and bounded pending/history state.
- [x] Passive DR/DC disconnect handling when both references match known connection
      state and every TPDU in the NSDU verifies; release buffers and report closure.
- [x] Modern ESH source NSAP address lists, explicit legacy-single/raw ESH modes,
      and ISH end-system configuration timer with seconds.
- [x] Compressed CLNP caller-established address contexts and bounded offset
      reassembly: reversed fragments, overlap conflicts, isolation, expiry/reset
      and verified link-envelope gating (six regressions).
- [x] Captured verified uncompressed CLNP local-reference option 5 setup,
      priority-scoped directories, retained version/security/NSAPs, replacement,
      checksum failure and setup expiry (three regressions).
- [ ] Mobile SNDCF edition audit, circuit-group negotiation and Deflate contexts.
- [x] X.233 CLNP security/QoS, source/recorded routes, scope, radius, discard
      reason and priority option bodies, preserving malformed/unknown bytes
      (eleven regressions).
- [x] IDRP Open/Update/Error body structure, route withdrawal, raw typed path
      attributes and reachability; authentication remains unverified (four regressions).
- [x] All four IDRP RD_PATH segment forms, exact identifier boundaries and ATN
      security registration/tags, traffic/subnetwork flags and raw route policies
      with malformed/unknown retention (seven regressions).
- [ ] Remaining ES-IS/XID/IDRP options, detailed IDRP path/security/QoS attributes,
      validation mechanisms and usable current specification audit.
- [x] XID sequencing, refusal data, modulation masks, autotune frequencies,
      station address lists and nearest airport from pinned dumpvdl2, with
      malformed boundaries and unknown-mask retention (four regressions).
      Timer/counter names retain raw encodings and unverified units.
- [x] Automatic passive bidirectional class-4 COTP CR/CC matching, normal/extended
      format, TPDU-size and expedited selection, initial-credit reporting, connection
      generations and bounded reference quarantine after release/rejection/expiry.
      ISO checksums must verify; unsupported negotiation parameters remain raw.
- [x] X.224 preferred maximum TPDU size: one-to-four-byte unsigned 128-byte units,
      preferred selection or ordinary-size fallback, duplicate rules and raw values.
- [x] COTP per-peer acknowledgement/inactivity indications in milliseconds and
      ROA option negotiation, with independent local capture-expiry policies.
- [x] Explicit bounded COTP NSDU processing above 8192 bytes, configurable through
      65535 bytes in header decoding, passive sessions and explicit reassembly;
      negotiated TPDU and assembly limits remain enforced.
- [x] COTP advertised QoS/protection and alternative-class parameter bodies;
      negotiated selective ACK blocks with normal/extended wrap, cumulative
      trimming and bounded retention (eighteen regressions with checksum omission).
- [ ] COTP alternative-class selection/fallback and supported class procedures.
- [x] RFC 905 last-occurrence rules for duplicate COTP parameter IDs, retaining all
      occurrences and checking the whole TPDU with the effective checksum parameter.
- [x] Passive directional AK lower/upper-window, credit and subsequence tracking,
      stale/duplicate handling and FCC matching, with DT advertised-window evidence
      and explicit missing-capture indications; local resequencing remains bounded.
- [x] Passive EA matching and one outstanding observed ED per direction, plus
      negotiated non-blocking DT/ED dependency delivery ordering, including wrap,
      duplicates, pending expiry and resource bounds.
      The current audit also rejects out-of-sequence ED before it can queue several
      outstanding messages; an additional regression covers this case.
- [x] Passive DR/DC handshake evidence: requested/confirmed/crossed releases,
      pending-CR refusal/cancellation and unmatched DC, with reference quarantine,
      retransmission handling and original reason/user data retained.
- [ ] Complete COTP acknowledgement/release/flow-control procedures, including
      selective blocks, retransmission timers and error-release variants.
- [x] COTP ER cause/rejected-header evidence, pending-CR release/quarantine and
      established-connection retention until an observed release (three regressions).
- [ ] Broader COTP cross-service inference for captures missing ED/EA or dependency
      parameters; blocking TS-user request ordering cannot be established from wire
      order alone. Active transport responses remain outside the passive API.
- [x] Mutually selected class-4 ISO checksum omission; requests still verify,
      failed present checksums remain rejected and omission evidence is explicit.
- [x] Address-bound ATN 16/32-bit COTP checksum verification adapted from pinned
      Wireshark; separate ISO/ATN results and independent mathematical fixtures
      (seven regressions).
- [x] Retain ATN checksum width and directed NSAPs through session/explicit
      assembly; reject disappearing/changing checksums and address changes
      (three further regressions).
      Verified CR retransmissions compare semantic parameters while preserving
      the checksum scheme; reordered parameters and changed contexts are tested.
- [ ] ATN checksum independent specification/capture audit; upstream's 16-bit
      routine is marked untested, so mathematical agreement alone is insufficient.
- [x] HFDL CRC-verified multipart system tables, signed coordinates, BCD frequencies,
      station slots, 12-bit version ordering and bounded source-isolated assembly
      (seven regressions).
- [ ] HFDL SPDU slot allocations and remaining documented table/transport variants.
- [x] Demodulated Aero R and P/T signal-unit CRC, bounded multipart ACARS assembly,
      duplicates/conflicts, missing initial segments and isolation/reset/expiry
      adapted from pinned JAERO (six regressions).
- [x] Aero R user-data/control discriminator, C-channel assignments, P/R bitrate,
      satellite/GES frequency broadcasts in Hz and raw remaining controls
      (seven regressions).
- [x] Satellite ACARS envelope parity/BCS, source-derived uplink/downlink direction,
      letter block IDs and full text without a VHF flight/message prefix;
      strict delimiters and empty ACK boundaries (three regressions).
- [ ] Remaining documented Aero control/channel variants and transport scope audit.
- [x] JAERO native/JSONdump receiver records with original nested metadata and
      timestamp validation (three regressions).
- [x] JAERO JSONdump source-derived direction, native unknown direction and
      documented empty-text ACK variants (two further regressions).
- [ ] Remaining receiver dialect inventory and replay.

For each remaining transport item, retain protocol bytes and include independently
encoded valid/truncated/checksum-failed cases, source/context isolation, resets,
expiry and resource bounds. Header recognition and phrase catalogues do not
establish complete application or measurement coverage.

Validation for this batch: `npm run check`, all 2,131 JavaScript tests in 76 files,
five Python data tests, production build and packed-package Node/TypeScript/browser
checks pass. All five supplied captures replay through the API and CLI with raw
metadata/assembly preservation and no coverage regression from the previous batch.
The 487 blocks total 294 decoded, 74 partial and 119 unknown. These application
captures do not independently validate the new binary transport wire formats;
synthetic protocol regressions cover those implemented scopes.

## Streaming and receiver scope

- [ ] Incremental application/session engines with long-running mixed-source replay.
- [ ] Richer expiry/eviction/duplicate events and reconnect lifecycle handling.
- [ ] MIAM negotiated pacing/state and additional application identifiers.
- [ ] Additional OHMA variants and documented proprietary fields/integrity rules.
- [ ] Define whether audio/IQ demodulation, radio drivers and DSP belong in the
      release scope; these extend a message library into a receiver.
- [ ] If included, validate ACARS/VDL2/HFDL/SATCOM demodulation against RF recordings
      with reproducible bit/error-rate measurements.

## Migration, correctness and comparative evidence

- [ ] Complete the public-source inventory, including GPL projects, then port useful
      unique formats and tests with original source/fixture attribution and licenses.
- [ ] Finish upstream utility/subclass assertions and audit every imported fixture.
- [ ] Replace shallow “decodes in either direction” CPDLC corpus checks with known
      directions and independent full field/unit expectations.
- [ ] Complete typed semantic comparisons for the runnable Airframes corpus;
      the existing 304 display comparisons are useful but not semantic equivalence.
- [ ] Build a pinned differential runner using identical complete public inputs
      across relevant decoders: values, units, direction, integrity, unknown bytes,
      reassembly and rejection reasons.
- [ ] Review unresolved divergences against specifications. Acceptance of corrupt
      data by another implementation does not establish correct decoding.
- [ ] Run sustained fuzz/property campaigns for ASN.1, framing, compression and
      state machines, beyond current deterministic mutation/unit regressions.
- [ ] Run long mixed-protocol replays with loss, reordering, duplicates, wraparound,
      connection reuse, source isolation and expiry/resource measurements.
- [ ] Publish reproducible comparative throughput, latency, memory and bundle-size
      benchmarks with environments, versions and corpus hashes.
- [ ] Standardize typed application results: raw spans, units, provenance, integrity,
      unconsumed data and assembly status; derive display fields from those results.
- [ ] Validate supported Node/browser/worker environments and keep release/API/package
      documentation current as scope expands.
- [ ] Publish a release coverage matrix and comparison report listing unresolved
      formats/divergences and capture limitations before making a ranking claim.

GPL sources are in scope; retain their licenses and attribution when incorporating
code or tests. Failed checksums, missing
blocks, encryption and unknown fields must remain explicit with originals retained.

A comprehensive release for a defined scope accounts for every required format
and schema choice, verifies semantics/integrity independently and passes complete
multi-layer/capture regressions. Its ranking must be measured for coverage,
correctness, reliability and performance, and can change with new releases/formats.
