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

## Troubleshooting

**Extension doesn't detect viewer:**
- Try refreshing the page
- Use manual manifest URL input
- Check browser console for errors

**Downloads fail:**
- Some servers may have CORS restrictions
- Try a different image quality/format
- Check your internet connection

## License

MIT License - Feel free to modify and distribute.
