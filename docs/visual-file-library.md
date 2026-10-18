# Homely — compact Files library

The Files workspace is a compact, single-column record list within Homely's monochrome shell. It keeps household files easy to scan without loading thumbnails, media metadata, or a permanent inspector for every item. Actual evidence is loaded only after the user opens a file.

## List
- Each row shows a file-type icon, the full accessible name, and its primary household association.
- Long names stay on one line, fade when truncated, and expose the complete filename as a title.
- Search is optional and stays collapsed by default. Counts, selection, uploads, and link actions remain available.
- Responsive rows use the same single-column layout on desktop and Android; selection is visible without adding cards or columns.
- The list does not fetch image/video bytes or create preview elements. External links are not requested while browsing.

## Viewer and interaction
- Single click/tap selects a file; double-click/double-tap or keyboard Enter opens it.
- The dedicated viewer loads the selected image, audio, video, PDF, text, or source link. Media stays behind the authenticated file route.
- Video playback uses metadata and byte-range requests rather than eagerly downloading the entire file.
- Analysis remains an explicit viewer action. It does not update authoritative household records.

## Owner evidence export
The household export contains the original uploaded bytes and structured Homely records, plus a print-friendly HTML register, CSV register, and SHA-256 checksum list. The register distinguishes Homely's evidence date from its recorded UTC creation time and includes stored source, provenance, reason, status, household associations, and Homely transaction references. Checksums support byte comparison after export; they are not a digital signature or independent proof of authorship or time. The bundle does not certify legal admissibility.

## QA
Browser regressions cover compact row geometry, responsive widths, long-name fading, selection state, lazy evidence loading in the viewer, file uploads, and the broader Homely workspace. Sample image and video files exercise protected viewing and byte-range playback.

Manual review on a physical Android device remains needed for browser-specific video decoding and viewer appearance.
