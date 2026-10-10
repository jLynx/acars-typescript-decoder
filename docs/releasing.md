# Releasing to npm

The public npm package is `acars-decoder`. Its repository is
[jLynx/acars-typescript-decoder](https://github.com/jLynx/acars-typescript-decoder).
Preparing or packing a release does not publish it or reserve the npm name.

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
release a reproducible source revision. CI on Linux and Windows should pass for
that revision; local success does not establish the hosted CI result.

## First publication

Create an [npm account](https://www.npmjs.com/signup) and enable
[two-factor authentication](https://docs.npmjs.com/configuring-two-factor-authentication).
Sign in interactively; do not put credentials in repository files:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view acars-decoder name version --registry=https://registry.npmjs.org/
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
npm view acars-decoder@0.1.0 version dist.integrity --registry=https://registry.npmjs.org/
```

Open [npmjs.com/package/acars-decoder](https://www.npmjs.com/package/acars-decoder)
and test `npm install acars-decoder@0.1.0` in a separate consumer. After the first
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

## Optional automated publishing

CI currently validates packages and never publishes. After the initial release,
you can configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
for an explicitly triggered GitHub Actions release workflow. This uses OIDC instead
of stored npm tokens and supplies provenance for supported GitHub builds. Configure
the npm trusted publisher to match the repository and workflow before enabling it;
no npm token or automatic release workflow is needed for local publication.

The commands above follow npm's
[public package guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages)
and [publish command reference](https://docs.npmjs.com/cli/v11/commands/npm-publish).
