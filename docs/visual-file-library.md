# Homely — visual Files library

Make the Files workspace feel like a media library rather than a compressed database list. Keep the monochrome shell and existing record-oriented navigation, with color supplied primarily by the user's own photographs and videos. The layout adds no second navigation tier or permanent metadata inspector.

## Grid
- Adaptive thumbnail tiles: several columns on desktop, two on typical Android portrait widths, and one for narrow viewports.
- Each tile has a 4:3 preview, name and compact context caption. Long names fade rather than pushing other controls out of view.
- Local images use lazy decoded thumbnail elements. Local videos load metadata and seek slightly forward to display a frame, without autoplay.
- PDF, document, audio, text and unsupported types use legible format covers. Loading a grid never launches multiple heavy PDF viewers or downloads complete text files.
- External links use format covers, with no automatic requests to third-party sites when browsing the library.
- Failed or unavailable media falls back to the type icon. The existing full viewer handles PDFs, text files, downloads and optional document analysis.
- Sample household data includes a small self-contained SVG illustration to verify actual thumbnail loading.

## Interaction
Single click/tap selects a tile; double-click/tap opens it. Keyboard Enter opens it. Search is hidden until requested; filters, file counts, selection outlines, uploading and link actions all remain. No modifications to file storage, authentication, evidence retention or database schema.

## QA
Browser regression tests cover grid geometry, responsive widths, name fading, selected borders, protected image thumbnail loading, video preview source, opening behavior, empty search, file uploads and the broader Homely app.

Manual review on a physical Android device remains needed for browser-specific video decoding and thumbnail appearance.
