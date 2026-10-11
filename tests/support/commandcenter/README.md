# Command Center contract snapshot (test only)

These files preserve the real API kernel and its permission rules from the isolated API review used in the bot acceptance. They make tests runnable from this standalone repository without a sibling Command Center checkout. This is a test fixture, not a server or a second authority for API permissions. No database adapter, credentials or upstream client is included. The Docker build context excludes this directory.

Source: `outputs/commandcenter-review`, reviewed against Command Center baseline `e18456fb9490da090ea3a2e74b27ca9600c04234`, with the pagination fixes accepted in PR #87. When the API contract changes, refresh these files from a reviewed Command Center revision. Relative imports in the test copies may be adjusted for this repository's NodeNext TypeScript configuration.
