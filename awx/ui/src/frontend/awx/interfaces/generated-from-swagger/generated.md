# Generated interfaces

This directory contains the following auto-generated files:

1. `swagger.json` — the AWX OpenAPI schema, produced by `make genschema` (`awx-manage spectacular`).
2. `api.ts` — TypeScript interfaces generated from `swagger.json` via [swagger-typescript-api](https://www.npmjs.com/package/swagger-typescript-api).

> **Do not edit `api.ts` by hand.** Regenerate it using the workflow below.

The generated interfaces are used as base types by the hand-written interfaces in `../` (e.g. `Job.ts`, `Credential.ts`). They are extended/narrowed there rather than used directly.

There may be minor discrepancies between the swagger spec and the actual API responses, so manual tweaking is sometimes required in the derived interface files.

## Regenerating (automated workflow)

### Option 1 — Makefile (recommended, run inside the dev container)

```bash
# Regenerates schema.json then converts it to api.ts in one step
make gen-ui-types
```

### Option 2 — Shell script (also inside the dev container)

```bash
# Full regeneration (schema + TypeScript types)
bash tools/scripts/generate-awx-types.sh

# Only re-run the TypeScript conversion (reuse existing schema.json)
bash tools/scripts/generate-awx-types.sh --skip-schema
```

### Option 3 — npm script (schema.json must already exist at the repo root)

```bash
# Generate schema.json first (requires awx-manage)
make genschema

# Then from awx/ui/src:
cd awx/ui/src
npm run generate:types
```

After regeneration, review the diff in `api.ts` and commit the result together with any updates needed in the derived interface files under `../`.

## Development pattern

To create or update an interface from the generated types:

1. Create (or open) a file under `awx/ui/src/frontend/awx/interfaces/`.
2. Extend the generated base type, overriding fields that need stricter types:

    ```typescript
    import { Credential as SwaggerCredential } from './generated-from-swagger/api';

    export interface Credential extends Omit<SwaggerCredential, 'id' | 'name'> {
      id: number;
      name: string;
    }
    ```

