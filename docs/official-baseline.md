# Official SDK baseline

The repository started from the official `easyeda/pro-api-sdk` template and keeps its build/package layout separate from feature code.

| Item | Baseline |
| --- | --- |
| Template commit | `3cbb4005f9293e7df2baea93de132b6945a8f641` |
| Template version | `1.3.2` |
| `@jlceda/pro-api-types` | `0.3.6` |
| EDA engine | `^3.0.0` |
| Node.js | `>=20.17.0` |
| Host bundle | browser IIFE, `edaEsbuildExportName` |
| Extension entry | `./dist/index` |

The official type package currently declares React component-dialog types that conflict with DOM global declarations during full `tsc` validation. `skipLibCheck` is enabled only for dependency declaration files; project source remains under strict TypeScript checks.

## Upgrade procedure

1. Compare the new official `build/`, `config/`, TypeScript, ESLint and package baselines.
2. Update build baseline files independently from feature changes.
3. Re-run adapter contract tests and V3 manual validation for all BETA APIs.
4. Keep the existing `extension.json` UUID unchanged.
5. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
