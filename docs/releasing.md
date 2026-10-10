# Releasing to npm

The public npm package is `@jlynx_/acars-decoder`. Its repository is
[jLynx/acars-typescript-decoder](https://github.com/jLynx/acars-typescript-decoder).
Preparing or packing a release does not publish it or reserve the npm name.

This guide publishes to **npmjs.com**, not GitHub Packages. The GitHub repository
hosts the source and CI; `npm.pkg.github.com` is a separate registry with different
authentication and consumer setup. Keep `publishConfig.registry` pointed at
`https://registry.npmjs.org/` for normal public npm installation.

## Prepare and preview

Use a supported Node.js version and Python 3. From the repository root:

```sh
npm ci
npm run release:check
```

The release check runs `npm pack --dry-run`. The `prepack` lifecycle runs lint,
formatting, structure and type checks, the decoder suite, reference-data generator
tests, a fresh build and a clean-consumer smoke test. The smoke test packs with
`--ignore-scripts` internally to avoid recursively invoking `prepack`, installs
that tarball, and checks runtime exports, TypeScript declarations and browser bundles.
Finally, the dry run lists the files that would be uploaded. No package is uploaded.

Review `package.json`, the version, README, coverage guide and third-party notices.
The npm package includes built ESM modules, declarations, source maps, documentation,
MIT license and upstream notices. Raw source, tests and private captures are excluded
by the package file allowlist. Source maps contain source content; review them as
part of the public distribution.

Keep reviewed release changes committed in Git before publishing. This gives each
release a reproducible source revision. CI on Linux should pass for
that revision; local success does not establish the hosted CI result.

## First publication

Create an [npm account](https://www.npmjs.com/signup) and enable
[two-factor authentication](https://docs.npmjs.com/configuring-two-factor-authentication).
Publish using the npm account `jlynx_`, which owns the `@jlynx_` scope. The GitHub
username remains `jLynx`; GitHub and npm account names do not need to match.
Sign in interactively; do not put credentials in repository files:

```sh
npm login --scope=@jlynx_ --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @jlynx_/acars-decoder name version --registry=https://registry.npmjs.org/
```

An `E404` from the final command means no package is visible under that name at
that time. It does not reserve the name or guarantee npm will accept it. If the
name is claimed, choose another name and update the package metadata, imports,
smoke tests and documentation before publishing.

When ready to upload version `0.1.0`, run from the repository root:

```sh
npm publish --access public
```

This command publishes publicly and runs `prepack` again. Complete npm's interactive
authentication/2FA prompts. The package's `publishConfig` defaults to public access
on the official npm registry. For a final npm publication preview, use
`npm publish --dry-run --access public`; this also runs checks but does not upload.

Confirm the released version and package page:

```sh
npm view @jlynx_/acars-decoder@0.1.0 version dist.integrity --registry=https://registry.npmjs.org/
```

Open [npmjs.com/package/@jlynx_/acars-decoder](https://www.npmjs.com/package/@jlynx_/acars-decoder)
and test `npm install @jlynx_/acars-decoder@0.1.0` in a separate consumer. After the first
publication, replace the README's unpublished badge with a live npm version badge
and update its installation instructions. Tag the reviewed release revision
`v0.1.0` and push the tag to GitHub.

## Later releases

On a clean, committed checkout, use `npm version patch`, `npm version minor` or
`npm version major` as appropriate. These update both package files and create a
version commit and Git tag. In the `0.x` series, use a minor release for breaking
changes and a patch release for compatible fixes. Run the release check, publish,
verify the exact version, then push the release commit and tag.

An npm name/version pair cannot be reused, even after unpublishing. Fix an already
released package by incrementing the version. Publish prereleases with an explicit
tag such as `npm publish --tag next` so they do not replace `latest`.

## Complete a staged release

If the npm page shows **Temporary Holding Version** and version `0.0.0-stage`,
check **Staged Packages** and the registry version before drawing conclusions.
The public page may be cached even after approval. If the intended version appears
in Staged Packages but is absent from the registry, the actual release is still staged. This is npm's
placeholder README, not the library README. Review and approve the staged package
before consumers install it or the receiver switches to a registry dependency.

Sign in as `jlynx_`, then open **Staged Packages** on npmjs.com, review the intended
`0.1.0` release and click **Approve**. Complete the required 2FA prompt. Alternatively,
use a current npm CLI (staging requires npm 11.15+ and Node 22.14+):

```sh
npx npm@latest stage list @jlynx_/acars-decoder --registry=https://registry.npmjs.org/
npx npm@latest stage view STAGE_ID --registry=https://registry.npmjs.org/
npx npm@latest stage approve STAGE_ID --registry=https://registry.npmjs.org/
npm view @jlynx_/acars-decoder@0.1.0 version --registry=https://registry.npmjs.org/
```

Replace `STAGE_ID` with the ID from the list command. Approval publishes the staged
tarball publicly; local edits made after staging are not included. After approval,
update the README's unpublished badge and installation text and release a new
patch version if the published README needs correcting. Do not try to overwrite
the already released `0.1.0` version. See [npm's staged publishing guide](https://docs.npmjs.com/staged-publishing).

## GitHub release publishing

`.github/workflows/publish.yml` runs when you publish a GitHub release. It checks
that the release tag is `v` followed by the package version, installs dependencies,
runs coverage and the full prepack checks, and stages the package on npm with
provenance. Prereleases use `next`; ordinary releases use `latest`. A maintainer
then reviews and approves the staged release on npm with 2FA. No npm token is stored.

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) with:

- GitHub organization/user: `jLynx`
- Repository: `acars-typescript-decoder`
- Workflow filename: `publish.yml`
- Environment: leave blank
- Allowed action: staged publishing; direct publishing and dist-tag management are unnecessary.

Commit and push the workflow and release changes before creating a GitHub release.
The tag must point at the commit containing the intended package version. Publishing
a GitHub release uploads the package to npm staging; it does not approve it. Check
the workflow result, then approve the staged package and verify its public version.
The regular CI workflow only validates code.

The commands above follow npm's
[public scoped package guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages)
and [publish command reference](https://docs.npmjs.com/cli/v11/commands/npm-publish).
