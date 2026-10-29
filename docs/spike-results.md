# Spike results: asApp access to Assets

The spike established that the app account can read Assets schemas, object types, attributes and objects from scheduled and web triggers. Schema visibility depends on the app account's access; grant a role in each schema that needs a backup.

## Forge Object Store

A development round trip verified upload, metadata retrieval, ranged download and deletion using pre-signed URLs. The upload did not require an external fetch permission. Object Store is a Forge Preview feature; verify its current limits, pricing, expiry behavior and production availability before relying on it.

- Import the client as `import { objectStore } from '@forge/object-store'`.
- Keep an index of backups in KVS because the tested API did not provide a list operation.
- KVS requires the `storage:app` scope.
- Use the named `makeResolver` and `objectStore` exports.

## Assets API findings

- Use AQL `totalcount` instead of `objectCount` from `objecttypes/flat`.
- The `route` tag rejects slashes in interpolated strings; build validated paths and wrap them with `assumeTrustedRoute`.
- Measure representative workloads against the consumer time limit.

The backup consumer and admin page subsequently added ZIP upload and download support.
