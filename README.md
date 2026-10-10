# acars-typescript-decoder

[![npm: Not yet published](https://img.shields.io/badge/npm-not%20yet%20published-lightgrey?logo=npm)](#installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
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
ADS-C/FANS CPDLC readers, MIAM CORE v1/v2 transfers and Boeing OHMA/RYKO compressed
JSON. Original messages are preserved, and results distinguish decoded, partial
and unknown payloads.

The project builds on research and implementations from
[Airframes](https://github.com/airframesio/acars-decoder-typescript),
[libacars](https://github.com/szpajder/libacars),
[datalink](https://github.com/xoolive/datalink) and
[Skyshark](https://github.com/ckuethe/skyshark). See the
[coverage and source references](docs/coverage.md) for supported formats and gaps.
A recognized label or report header does not imply its measurements are decoded.

Contributions are welcome. You can use this library in your own applications,
including commercial and closed-source software, under the [MIT license](LICENSE).
The repository is [**acars-typescript-decoder**](https://github.com/jLynx/acars-typescript-decoder); the npm package name is
**@jlynx\_/acars-decoder**. The package has not yet been published to npm.

## Node.js support policy

- Runtime: Node.js 22.x starting at 22.13.0, or Node.js 24 and later.
- CI configuration: Node.js 22.x, 24.x and 26.x on Linux and Windows, with Python 3.14 for generator tests.
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

Until the first npm release, build and install a local package:

```sh
npm ci
npm run build
npm pack
# In your consuming project:
npm install /path/to/jlynx_-acars-decoder-0.1.0.tgz
```

Once published, the package will be installed with `npm install @jlynx_/acars-decoder`.
It is a separate package from the MIT-licensed `@airframes/acars-decoder` dependency.

## Publishing

Run `npm run release:check` to validate a release and preview its package contents
without uploading anything. Both `npm pack` and `npm publish` automatically run
lint, formatting, structure, type, decoder, data-generator and clean-install checks
against a fresh build. Development release checks require Python 3; consumers do not.

See the [release guide](docs/releasing.md) for npm account setup, first publication
and version updates. Publishing requires an npm account with permission to use the
package name. CI currently validates packages without publishing them.

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
and the final block receives `assembledText` only after consecutive A–Z message
suffixes and final ETX arrive. Missing blocks never get silently filled.

Batches allow up to 10,000 records, individual/assembled payloads up to 8,192
characters, and assemblies up to 26 blocks. Reassembly permits two minutes between
blocks and five minutes overall. Calls do not retain pending messages: pass the
retained source log again as new blocks arrive. The library does not truncate logs
to a viewer-specific count.

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
it cannot verify a BCS that is absent. IQ/audio demodulation, radio drivers, VDL2,
HFDL and SATCOM transport are outside this package.

`interpretArinc`, `decodeAdsc` and `decodeCpdlc` are exported for protocol use.
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
```

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

Licensed under **MIT**. See [LICENSE](LICENSE) for the full terms. Upstream
components retain their required notices, and the optional OurAirports dataset
is public domain. Proprietary reports still require their specifications to decode.
