# Completion checklist

Updated 10 October 2026 at the close of this priority 2 implementation batch.
The user requested wrapping up the current work; the nine remaining priority 2
checkboxes stay open for future work. Priority 1 has not been started in this batch.
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

- [ ] ATN upper-layer session/presentation decoding with typed context identifiers
      and retained unsupported bytes.
- [ ] ATN B1 CPDLC application decoding using licensed schemas and known directions.
- [ ] ATN B2 CPDLC and context management.
- [ ] ATN ADS-C v2.
- [ ] ATN checksum and protected-message integrity verification before measurements.
- [ ] ATS text CRC verification using documented coverage/encoding rules and
      independently verified valid/corrupt examples.
- [ ] Further AFN/TI2/OC1 variants; distinguish weather tokens from checksums.
- [ ] Complete FANS CPDLC body/schema validation for every required element/choice,
      direction, boundary and malformed/truncated body.
- [ ] Remaining FANS ADS-C tags/variants with independent field/unit expectations.
- [ ] Encoded T5/TOF and T6 aircraft report bodies.
- [ ] Airbus application-part assembly using verified identifiers and part rules,
      including any documented relationships across radio message numbers.
- [ ] Licensed Boeing/Airbus measurement dictionaries with explicit units/scales
      and independently checked expected values.
- [ ] Further airline/weather payload variants through the public dispatcher.
- [x] Observed H1/CF RTR maintenance XML fields, including CRC-verified MIAM
      embedded dispatch, repeated records and typed paths with original XML retained.
- [ ] Complete RTR schema/version coverage and independently verified mappings
      for proprietary status/phase/class codes; the observed layout remains partial.

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
