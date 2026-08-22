# dsh-desk-plugin

DeepSeek Harness bridge for the DSH Desk desktop pet. The plugin observes
Harness lifecycle and session events, then sends bounded event metadata to the
DSH Desk loopback server. Approval requests are offered to DSH Desk first
and fall through to the next Harness answerer when the desktop app is absent.

## Local installation

Run this from the repository root after installing DeepSeek Harness:

```powershell
npm install --prefix ./dsh-plugin
dsh plugin --profile web add ./dsh-plugin
dsh --profile web --dump-config
```

The first command is only needed for a linked source checkout. npm and tarball
installs materialize the package dependencies automatically.

Install the same package into another profile, such as `headless`, when that
profile should emit DSH Desk events.

## Configuration

The bundle defaults to DSH Desk's loopback port `17321`. Override the timeout
or port fields in the profile patch when the desktop app uses different values.

The bridge sends event names, session ids, tool names, bounded tool arguments,
bounded error text, and numeric token usage with provider/model/cwd metadata.
It does not send prompts, assistant messages, tool results, credentials, or
model request bodies. DSH Desk stores usage locally in `dsh-usage.ndjson`
under Electron's DSH Desk user-data directory.

The bridge also publishes the Loader's non-group plugin inventory to the same
loopback server. Each entry carries the top-level profile bundle that first
inserted it; entries created by an aggregate plugin inherit that bundle from
their nearest runtime ancestor. DSH Desk schemes therefore switch one installed
bundle and project that state to all of its entries instead of treating internal
Loader modules as separate plugins. Core DeepSeek Harness bundles and the bridge
itself remain read-only. The inventory is republished after Loader changes and
periodically so starting DSH Desk after
Harness does not require a Harness restart.

Theme installs, updates, and removals run `pnpm prune --ignore-scripts` after a
successful package mutation. This only removes extraneous materialized packages
from that profile's `node_modules`; it preserves declared dependencies and never
clears the shared pnpm store.
