# imp-action

Run [go-imp](https://github.com/smedijan/go-imp), a Go mutation testing tool, in GitHub Actions. Downloads the latest stable release binary by default and verifies it against the release SHA-256 checksums. No source build is performed.

## Usage

```yaml
name: Mutation tests
on: [push, pull_request]
permissions:
  contents: read
jobs:
  mutation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Needed when comparing against Git history with diff
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - uses: smedijan/imp-action@main
        with:
          imp-version: latest # Or pin a release, e.g. v0.8.0 (0.8.0 also works)
          threshold-efficacy: '80'
          exclude-files: |
            .*_generated\.go$
            mocks/.*
```

Pin the action to a commit SHA for reproducible workflows; pin `imp-version` too to avoid automatic tool upgrades.

## Inputs

Inputs mirror the long flags of `imp run`, including global configuration flags and all mutation toggles. Empty inputs are **not passed**: go-imp retains its own defaults, environment variables and configuration-file behavior. Explicit `'false'` overrides a configured boolean. Quote boolean and numeric values in YAML. Repeated flags use newline-separated values; commas in regular expressions are preserved. Values are passed as individual arguments, never evaluated as shell code.

| Input | Meaning | Action default |
| --- | --- | --- |
| `imp-version` | Release version to download, or latest | `latest` |
| `path` | Go module path | `.` |
| `config` | Read configuration from FILE | Unset |
| `quiet` | Suppress progress, not reports or errors | Unset |
| `no-color` | Disable colored output | Unset |
| `json` | Write grouped JSON | Unset |
| `statuses` | Comma-separated statuses to report | Unset |
| `verbose` | Expand source context and test commands | Unset |
| `dry-run` | Gather coverage and mutations without testing | Unset |
| `tags` | Comma-separated Go build tags | Unset |
| `coverpkg` | Comma-separated coverage package patterns | Unset |
| `diff` | Limit mutations to changes against Git REF | Unset |
| `output` | Report destination FILE (- for stdout) | Unset |
| `integration` | Run the whole module test suite per mutation | Unset |
| `exclude-files` | Exclude path regular expressions, one per line | Unset |
| `include-files` | Include path regular expressions, one per line | Unset |
| `exclude-workdir` | Omit module-relative paths from worker copies, one per line | Unset |
| `threshold-efficacy` | Required test efficacy percentage (0 disables) | Unset |
| `threshold-mcover` | Required mutant coverage percentage (0 disables) | Unset |
| `workers` | Mutation workers (0 selects automatically) | Unset |
| `test-cpu` | Go test CPU option (0 leaves unset) | Unset |
| `timeout-coefficient` | Coverage time multiplier for timeouts (0 uses five) | Unset |
| `conditionals-boundary` | Enable conditionals-boundary mutants | Unset |
| `conditionals-negation` | Enable conditionals-negation mutants | Unset |
| `increment-decrement` | Enable increment-decrement mutants | Unset |
| `invert-logical` | Enable invert-logical mutants | Unset |
| `invert-negatives` | Enable invert-negatives mutants | Unset |
| `arithmetic-base` | Enable arithmetic-base mutants | Unset |
| `invert-loopctrl` | Enable invert-loopctrl mutants | Unset |
| `invert-assignments` | Enable invert-assignments mutants | Unset |
| `invert-bitwise` | Enable invert-bitwise mutants | Unset |
| `invert-bwassign` | Enable invert-bwassign mutants | Unset |
| `remove-self-assignments` | Enable remove-self-assignments mutants | Unset |

## Requirements and behavior

- Check out your repository and install the appropriate Go version first.
- GitHub-hosted Linux, macOS and Windows runners are supported. Self-hosted runners need Python 3.9+, Bash, Go, and network access to GitHub release assets/API. A binary must exist for the runner OS/architecture.
- `path` selects the module to test; `config` and `output` are resolved from the workspace working directory, just as with the CLI.
- The action runs `imp run`; informational `--help` and root `--version` are not mutation-run inputs. `imp-version` selects the downloaded release, not the CLI's version-print flag.
- Flag support depends on the selected go-imp version. Older releases may reject newer flags; unset inputs are never forwarded.
- Reports go to the job log unless `output` is set. Use `actions/upload-artifact` separately to retain report files.
- The CLI exit status is propagated, including quality-gate failures. Use the step's standard `continue-on-error` setting if failures should be advisory.
- `latest` means GitHub's latest non-prerelease release. Checksums detect corrupt downloads, not a compromised upstream release.

See [go-imp documentation](https://github.com/smedijan/go-imp#readme) for configuration, mutation types, thresholds and report semantics.

## Development

```sh
python3 -m unittest discover -s tests -v
```
