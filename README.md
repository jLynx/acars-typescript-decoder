# acars-typescript-decoder

[![npm version](https://img.shields.io/npm/v/%40jlynx_%2Facars-decoder?logo=npm)](https://www.npmjs.com/package/@jlynx_/acars-decoder)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)
[![CI](https://github.com/jLynx/acars-typescript-decoder/actions/workflows/ci.yml/badge.svg)](https://github.com/jLynx/acars-typescript-decoder/actions/workflows/ci.yml)
[![Contributors](https://img.shields.io/github/contributors/jLynx/acars-typescript-decoder)](https://github.com/jLynx/acars-typescript-decoder/graphs/contributors)
[![Activity](https://img.shields.io/github/commit-activity/m/jLynx/acars-typescript-decoder)](https://github.com/jLynx/acars-typescript-decoder/pulse)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20%7C%2024%2B-339933?logo=nodedotjs&logoColor=white)](#nodejs-support-policy)

Decode ACARS aircraft messages in JavaScript or TypeScript, locally in Node.js or
modern browsers. Published as **@jlynx\_/acars-decoder** on npm.

- Read supported airline, weather, ADS-C and FANS CPDLC messages.
- Reassemble ACARS blocks, MIAM files and OHMA/RYKO conversations.
- Import receiver logs or use lower-level VDL2, HFDL and Aero readers.
- Preserve original data and distinguish decoded, partial and unknown results.

Support varies by format. Recognizing a label does not mean its measurements are
decoded; see the [coverage guide](docs/coverage.md) for exact scopes and limitations.

## Installation

```sh
npm install @jlynx_/acars-decoder
```

This is a separate package from `@airframes/acars-decoder`.

## Quick start

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

`label` and `text` are required. Direction defaults to `downlink`; provide the
actual reception timestamp for time-only reports. Field values are display strings
with units where defined.

### Receiver streams

```ts
import { createDecoderSession, adaptReceiverRecord } from '@jlynx_/acars-decoder';

const session = createDecoderSession();
const received = adaptReceiverRecord({ label: 'Q0', text: '', timestamp: 1791576000 });

if (received) {
	const record = session.push(received.message, received.source);
	console.log(record.interpretation, record.assemblies);
}
```

Adapters support acarsdec, vdlm2dec, dumpvdl2, dumphfdl and JAERO records.
Sessions keep bounded, isolated source windows; use `snapshot()` to retrieve
earlier records completed by later arrivals.

### Command line

```sh
acars-decode messages.jsonl
acars-decode --capture capture.json
```

The CLI also accepts JSONL from stdin and writes interpreted JSONL. Capture mode
reads grouped `sources[].messages` viewer exports.

## More APIs

| Need                                | API                              |
| ----------------------------------- | -------------------------------- |
| Reassemble a retained source log    | `decodeLog(records)`             |
| Add plugins or an airport lookup    | `createDecoder(options)`         |
| Load optional offline airport names | `@jlynx_/acars-decoder/airports` |
| Read frames and transport protocols | `@jlynx_/acars-decoder/framing`  |
| Access lower-level format readers   | `@jlynx_/acars-decoder/formats`  |

See the [usage guide](docs/usage.md) for examples and API constraints.
Prefer `decode` or `decodeLog` for applications. Lower-level readers may throw on
malformed data and do not provide the same validation or enrichment.

## Documentation

- [Usage guide](docs/usage.md): log reassembly, plugins, airports and transport examples.
- [Decoding coverage](docs/coverage.md): supported formats, integrity checks and limits.
- [Observed capture formats](docs/capture-formats.md): aircraft reports and maintenance XML.
- [Completion checklist](docs/completion-roadmap.md): implemented scopes and remaining work.
- [Upstream audit](docs/upstream-audit.md) and [source manifest](docs/upstreams.json): provenance and pinned revisions.

## Node.js support policy

- Node.js 22.13+ within 22.x, or Node.js 24 and later.
- Modern ES2022 browsers; runtime decoding requires no network or Node-only APIs.
- ESM distribution with bundled TypeScript declarations and source maps.

## Development

Use Node.js 26 and Python 3.14 for development.

```sh
npm ci
npm run check
npm test
npm run test:data
npm run build
npm run test:package
```

## Contributions

Documented formats, regression fixtures and improvements are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for source, licensing and validation requirements.

## Contributors

Created and maintained by [jLynx](https://github.com/jLynx), building on work from
[Airframes](https://github.com/airframesio/acars-decoder-typescript),
[libacars](https://github.com/szpajder/libacars),
[datalink](https://github.com/xoolive/datalink) and
[Skyshark](https://github.com/ckuethe/skyshark).

## License

The combined package is **GPL-3.0-or-later**; see [LICENSE](LICENSE).
Original component notices are retained in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)
and [historical MIT terms](docs/MIT-LICENSE.txt). The optional OurAirports dataset
is public domain.
