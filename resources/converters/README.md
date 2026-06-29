# LitAgent Converter Runtimes

This directory is the development-time mirror of the converter runtime directory
that Electron packages should copy into `process.resourcesPath/converters`.

Marker is a Python application, not a Bun/npm dependency. LitAgent resolves it
in this order:

1. `LITAGENT_MARKER_BIN`, when set to a `marker_single` executable.
2. A bundled executable at one of:
   - `converters/marker/marker_single`
   - `converters/marker/bin/marker_single`
   - `converters/marker/Scripts/marker_single.exe`
   - `converters/marker_single`
3. Development fallback: `uvx --from marker-pdf marker_single`.

Do not commit generated Python environments, model caches, or converter bundles
here. The packaging pipeline should create or copy the platform-specific runtime
before building the Electron app.
