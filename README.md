# IIIF Manifest Downloader

A Chrome extension that detects IIIF/Mirador viewers on web pages and allows you to bulk download all pages from the manifest.

## Features

- Automatically detects IIIF viewers (Mirador, Universal Viewer, Diva.js, etc.)
- Extracts manifest URLs from page content
- Lists all available pages with labels
- **Two download modes:**
  - **Individual Images**: Download each page as a separate image file
  - **Combined PDF**: Combine all pages into a single PDF document
- Configurable image quality and format (JPG, PNG, WebP)
- PDF options: custom filename, page size (Auto/A4/Letter/Legal)
- Progress tracking during download
- Cancel download at any time
- Manual manifest URL input for pages without detected viewers

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select the `iiif-downloader-extension` folder
5. The extension icon should appear in your toolbar

## Usage

1. Navigate to any page with an IIIF viewer (like the UNBC Archives)
2. Click the extension icon in the toolbar
3. The extension will automatically detect the viewer and load the manifest
4. Review the list of pages
5. Choose download mode:
   - **Individual Images**: Downloads each page as a separate file
   - **Combined PDF**: Creates a single PDF with all pages
6. Configure options:
   - For images: page numbers in filename, image format
   - For PDF: filename, page size
   - Image quality (applies to both modes)
7. Click "Download All Pages" or "Download as PDF"

### Manual Mode

If the extension doesn't automatically detect the manifest:
1. Find the IIIF manifest URL (usually ends with `/manifest` or `/manifest.json`)
2. Paste it into the manual input field
3. Click "Load Manifest"

## Supported Viewers

- Mirador
- Universal Viewer
- Diva.js
- OpenSeadragon
- Any page with IIIF manifest links

## IIIF Image API Options

- **Quality**: Full resolution, 1024px, 800px, or 512px width
- **Format**: JPEG, PNG, or WebP

The extension detects the image service version per page and requests full
resolution using the correct size keyword — `full/max` for Image API **v3**
(`ImageService3`) and `full/full` for **v2**. This avoids errors on v3 servers,
which no longer accept the `full` size keyword.

## Optional: Add Custom Icons

1. Open `generate-icons.html` in your browser
2. Download each icon size (16x16, 48x48, 128x128)
3. Save them to the `icons` folder as `icon16.png`, `icon48.png`, `icon128.png`
4. Update `manifest.json` to include the icons (see commented section)

## Technical Details

This extension uses the IIIF Presentation API (v2 and v3) to:
1. Parse manifest JSON files
2. Extract canvas and image resource URLs
3. Download images using the IIIF Image API

### Reliability

- **Transient server errors are retried.** Requests that return 403/429
  (rate limiting) or 500/502/503/504 (gateway/server errors) are retried with
  exponential backoff. IIIF image servers commonly return 502/503 while
  generating large derivatives on the fly, so this prevents pages from being
  marked as failed unnecessarily.
- **Stalled downloads are not counted as successes.** If a download does not
  finish within the timeout, its real state is checked and a still-incomplete
  download is treated as a failure (and retried) rather than silently accepted.

### Pages with no image ("missing" canvases)

Some manifests list a page (canvas) that has a label but **no image** — usually
because a derivative failed to generate when the item was published. Rather than
silently dropping such pages (which would make the page count wrong and produce
a short PDF without warning), the extension:

- keeps the page in the list and marks it **⚠ no image**,
- shows a notice with how many pages are affected, and
- skips those pages during download, counting them in the failed tally.

Because the extension is a generic IIIF tool, it cannot recover an image that is
absent from the manifest. If you need that page, locate the original/master file
through the source repository.

### Filenames

The default PDF filename (and label-based image filenames) preserve the
human-readable title — spaces, commas, and parentheses are kept; only characters
that are illegal in filenames (`< > : " / \ | ? *`) are removed.

## Troubleshooting

**Extension doesn't detect viewer:**
- Try refreshing the page
- Use manual manifest URL input
- Check browser console for errors

**Downloads fail:**
- Some servers may have CORS restrictions
- Try a different image quality/format
- Check your internet connection

**A page is marked "⚠ no image":**
- That canvas has no image in the manifest; it will be skipped
- The image may still exist in the source repository as an original/master file

## License

MIT License - Feel free to modify and distribute.
