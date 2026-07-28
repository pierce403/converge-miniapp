# Known tooling pitfalls

## Repository search

Targeted `rg` is the verified repository-memory search path. The installed
`qmd` command can display help, but initialization currently fails under the
repository's supported Node runtime because its `better-sqlite3` binary was
compiled for another Node ABI. Do not create or commit a `.qmd` index, and do
not describe `qmd` as working until a separate repair passes a real search.

## Wrangler logs in restricted desktop runs

The Cloudflare Vite build can emit an `EROFS` warning when Wrangler tries to
write its debug log below the desktop session's read-only user configuration
directory. Judge the gate by the command exit status and completed build
artifacts, not by the warning alone. A nonzero build remains a real failure;
do not suppress or reinterpret it.

The same restricted sandbox can make Cloudflare Vite preview startup fail at
`uv_interface_addresses` before Playwright begins. Rerun the unchanged
`npm run verify` with the required local host permission so the preview server
can enumerate loopback interfaces. Do not delete the browser gate or treat the
sandbox failure as an application regression.

## Nested knowledge logs

The root runtime log directory is ignored as `/logs/`. Keep that pattern
root-anchored so Markdown under `agent-memory/logs/` remains tracked.
