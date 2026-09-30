# vendor/

Pinned, read-only copies of third-party data the CLI must be able to run without.

## taxonomies/

The eight ADC controlled vocabularies (`<Name>-v1.json`), copied verbatim from
[`@npa-ai-co-lab/adc-schema`](https://github.com/NPA-AI-Co-Lab/adc-schema) **1.0.0** (the
version `package.json` depends on).

They are the **last-resort fallback** of the taxonomy resolver (`src/jsonld/taxonomy.ts`),
used only when neither an explicit `taxonomiesPath` / `--taxonomies` nor the installed
`@npa-ai-co-lab/adc-schema` package is available — for example on an offline or air-gapped
machine. The run summary reports `Taxonomies: vendor (...)` when this copy is in use.

## Keeping it in sync

**Do not edit these files.** The standard lives in the `adc-schema` repository; changes are
made there, released, and then this copy is refreshed to the version the CLI depends on:

- `npm run vendor:sync` — copies the installed package's `taxonomies/*.json` into
  `vendor/taxonomies/` and deletes vendored files the package no longer ships. Run it after
  bumping the dependency and commit the result.
- `npm run vendor:check` — exits non-zero when `vendor/taxonomies/` differs from the installed
  package. Runs in CI and before `npm pack` / `npm publish` (`prepack`).
