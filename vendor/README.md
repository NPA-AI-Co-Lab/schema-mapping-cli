# vendor/

Pinned, read-only copies of third-party data the CLI must be able to run without.

## taxonomies/

The eight ADC controlled vocabularies, copied verbatim from
[`@npa-ai-co-lab/adc-schema`](https://github.com/NPA-AI-Co-Lab/adc-schema) **1.0.0**.

They are the **last-resort fallback** of the taxonomy resolver (`src/jsonld/taxonomy.ts`),
used only when neither an explicit `taxonomiesPath` / `--taxonomies` nor the installed
`@npa-ai-co-lab/adc-schema` package is available — for example on an offline or air-gapped
machine. The run summary reports `Taxonomies: vendor (...)` when this copy is in use.

**Do not edit these files.** The standard lives in the `adc-schema` repository; changes are
made there, released, and then this copy is refreshed to the version the CLI depends on.
