# imp-action

Run [go-imp](https://github.com/smedijan/go-imp) mutation tests using your repository's `.imp.yaml`. Downloads a release binary, verifies its SHA-256 checksum, and runs `imp run`.

## Usage

```yaml
name: Mutation tests
on:
  push:
    branches: [main]
  pull_request:
  merge_group:
permissions:
  contents: read
jobs:
  mutation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - uses: smedijan/imp-action@main
```

This uses `.imp.yaml` for mutation settings, compares PRs/merge queues against their base, and runs the full suite on the default branch. Pin the action to a commit SHA and `version` to a release for reproducible workflows.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `version` | `latest` | Latest stable go-imp release, or a release such as `v0.8.0` / `0.8.0` |
| `args` | empty | Additional `imp run` arguments, **one argument per line** |
| `diff` | `auto` | Automatic diff scope, `off` for a full run, or an explicit Git ref |

```yaml
- uses: smedijan/imp-action@main
  with:
    version: v0.8.0
    diff: auto
    args: |
      --dry-run
      --output=mutation report.json
```

Arguments are passed literally, not parsed as shell code: no shell expansion or quoting is needed. Use `--flag=value` for a value containing spaces. Repeated flags occupy separate lines. A module subdirectory can be passed as a positional argument; use `--config=path/to/.imp.yaml` if needed. Relative paths are resolved from the workspace root.

### Automatic diff scope

| Context | Comparison base |
| --- | --- |
| Pull request | PR base commit from the event |
| Merge queue (`merge_group`) | Merge-group base commit from the event |
| Default branch | No diff: full run |
| Other branches or tags | `origin/<default branch>` |

The default branch is read from GitHub's event payload, not assumed to be `main`. Go-imp compares against the merge-base, supporting both the default synthetic PR merge checkout and PR-head checkouts. Use `actions/checkout` with `fetch-depth: 0`; unavailable refs or missing history fail clearly. The action does not fetch or change your checkout. If event metadata cannot identify the default branch, set `diff` to an explicit ref or `off`.

`diff` is the only CLI setting owned by the action: it overrides any diff in `.imp.yaml` or the environment, including clearing it for full runs. Do not pass `--diff` or `-D` in `args`. All other settings retain go-imp's normal configuration behavior.

## Requirements and behavior

- Check out your code and set up Go first. No separate Node/Python setup is needed: GitHub runs the bundled JavaScript action using its **Node 24** runtime. Self-hosted runners must support `node24` JavaScript actions.
- Linux, macOS and Windows are supported where go-imp provides a matching release binary. Network access to GitHub's release pages and assets is required; no API token is needed.
- Git line-ending safety warnings are disabled only for the imp subprocess, because imp combines Git stdout/stderr when parsing patches. Checkout files, line-ending conversion and repository configuration are not changed.
- `latest` selects GitHub's latest non-prerelease release via its public release redirect, avoiding unauthenticated API rate limits. Explicit versions avoid automatic tool upgrades. Checksums detect corrupted downloads, not compromised upstream releases.
- The CLI exit status is propagated, including quality-gate failures. Use the step's `continue-on-error` setting for advisory checks.
- Reports go to the job log unless configured otherwise. Retain report files with `actions/upload-artifact` if desired.
- Flags available through `args` depend on the selected go-imp version.

See [go-imp documentation](https://github.com/smedijan/go-imp#readme) for `.imp.yaml`, mutation types, quality gates and reporting.

## Development

With Node 24:

```sh
npm ci
npm test
npm run build
```

Commit `dist/` after source/dependency changes: GitHub executes the bundle without installing packages. CI tests the action on Linux, macOS and Windows and checks that the bundle is current.
