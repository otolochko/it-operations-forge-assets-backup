# Backup format

A backup is the package of `../it-operations-forge-assets-export/docs/export-format.md` (format version 2): one ZIP, one folder per schema, `data/*.ndjson` for restore, CSV files for people. Emails, avatars and media tokens are never written.

Differences from the export app:

- The root `manifest.json` has an extra field `missingSchemas`: selected schema keys that the app account could not see. Empty array when every configured schema was backed up.
- Always all object types of a schema, no AQL filter (`filter` is `null`), CSV always on.
- The file is stored in Forge Object Store as `backups/{planId}/{YYYYMMDDTHHMMSSZ}.zip` (UTC start time) with the plan's retention as TTL. Every run gets its own file.
- A type that fails is marked `failed: <message>` in `data/manifest.json`, as in the export app. A restore must skip it.
