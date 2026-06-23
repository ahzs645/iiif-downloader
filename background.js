// IIIF Manifest Downloader - Background Service Worker

// Download state management
let downloadState = {
  isDownloading: false,
  cancelled: false,
  mode: null, // 'images' or 'pdf'
  pages: [],
  currentIndex: 0,
  completed: 0,
  failed: 0,
  options: {},
  imageData: [] // For PDF mode: stores fetched image data
};

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'download':
      // Single file download (legacy)
      downloadFile(request.url, request.filename)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'startDownload':
      // Start bulk download
      startBulkDownload(request.pages, request.options)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'cancelDownload':
      downloadState.cancelled = true;
      sendResponse({ success: true });
      return false;

    case 'getDownloadState':
      sendResponse({
        isDownloading: downloadState.isDownloading,
        currentIndex: downloadState.currentIndex,
        completed: downloadState.completed,
        failed: downloadState.failed,
        total: downloadState.pages.length,
        cancelled: downloadState.cancelled
      });
      return false;

    case 'createPDF':
      // Create PDF from collected image data (called from offscreen)
      sendResponse({ imageData: downloadState.imageData, options: downloadState.options });
      return false;

    case 'pdfComplete':
      // PDF generation complete
      downloadState.isDownloading = false;
      notifyPopup('downloadComplete', {
        completed: downloadState.completed,
        failed: downloadState.failed,
        total: downloadState.pages.length
      });
      return false;
  }
});

// Start bulk download
async function startBulkDownload(pages, options) {
  downloadState = {
    isDownloading: true,
    cancelled: false,
    mode: options.mode,
    pages: pages,
    currentIndex: 0,
    completed: 0,
    failed: 0,
    options: options,
    imageData: []
  };

  if (options.mode === 'pdf') {
    await downloadForPDF();
  } else {
    await downloadAsImages();
  }
}

// Fetch with retry logic
async function fetchWithRetry(url, maxRetries = 3, baseDelay = 2000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return response;
      }

      // Retry on rate limiting (403/429) AND transient server/gateway errors
      // (500/502/503/504). IIIF image servers commonly throw 502/503 while
      // generating large derivatives on the fly — those are worth retrying,
      // not failing outright.
      const RETRYABLE = [403, 429, 500, 502, 503, 504];
      if (RETRYABLE.includes(response.status)) {
        const waitTime = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`HTTP ${response.status}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const waitTime = baseDelay * Math.pow(2, attempt);
        console.log(`Request failed, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError;
}

// Download images and store for PDF creation
async function downloadForPDF() {
  const pages = downloadState.pages;
  const options = downloadState.options;

  for (let i = 0; i < pages.length; i++) {
    if (downloadState.cancelled) break;

    downloadState.currentIndex = i;
    notifyPopup('downloadProgress', {
      currentIndex: i,
      total: pages.length,
      status: 'downloading'
    });

    // Skip canvases that have no image in the manifest (counted as failed so
    // the final tally is honest) rather than fetching a null URL.
    if (pages[i].missing || !buildImageUrl(pages[i], options, true)) {
      console.warn(`Skipping page ${i + 1} (${pages[i].label}): no image in manifest`);
      downloadState.failed++;
      continue;
    }

    try {
      const imageUrl = buildImageUrl(pages[i], options, true); // force jpg for PDF
      const response = await fetchWithRetry(imageUrl);

      const blob = await response.blob();
      const base64 = await blobToBase64(blob);

      // Get image dimensions
      const dimensions = await getImageDimensionsFromBlob(blob);

      downloadState.imageData.push({
        base64: base64,
        width: dimensions.width,
        height: dimensions.height,
        index: i
      });

      downloadState.completed++;

      // Add delay between successful requests to avoid rate limiting
      if (i < pages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error fetching page ${i + 1}:`, error);
      downloadState.failed++;
    }
  }

  // Now create the PDF using offscreen document
  if (!downloadState.cancelled && downloadState.imageData.length > 0) {
    notifyPopup('downloadProgress', {
      currentIndex: pages.length,
      total: pages.length,
      status: 'creating_pdf'
    });

    await createPDFOffscreen();
  } else {
    downloadState.isDownloading = false;
    notifyPopup('downloadComplete', {
      completed: downloadState.completed,
      failed: downloadState.failed,
      total: pages.length,
      cancelled: downloadState.cancelled
    });
  }
}

// Download as individual images
async function downloadAsImages() {
  const pages = downloadState.pages;
  const options = downloadState.options;

  for (let i = 0; i < pages.length; i++) {
    if (downloadState.cancelled) break;

    downloadState.currentIndex = i;
    notifyPopup('downloadProgress', {
      currentIndex: i,
      total: pages.length,
      status: 'downloading'
    });

    // Skip canvases with no image in the manifest (honest failure count).
    if (pages[i].missing || !buildImageUrl(pages[i], options, false)) {
      console.warn(`Skipping page ${i + 1} (${pages[i].label}): no image in manifest`);
      downloadState.failed++;
      continue;
    }

    try {
      const imageUrl = buildImageUrl(pages[i], options, false);
      const filename = generateFilename(pages[i], i, options);

      await downloadFileWithRetry(imageUrl, filename);
      downloadState.completed++;
    } catch (error) {
      console.error(`Error downloading page ${i + 1}:`, error);
      downloadState.failed++;
    }

    // Longer delay between downloads to avoid rate limiting
    if (!downloadState.cancelled && i < pages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  downloadState.isDownloading = false;
  notifyPopup('downloadComplete', {
    completed: downloadState.completed,
    failed: downloadState.failed,
    total: pages.length,
    cancelled: downloadState.cancelled
  });
}

// Build image URL based on options
function buildImageUrl(page, options, forceJpg = false) {
  const quality = options.imageQuality || 'full';
  const format = forceJpg ? 'jpg' : (options.imageFormat || 'jpg');

  if (page.serviceUrl) {
    // IIIF Image API 3 replaced the "full" size keyword with "max". Using the
    // wrong one makes some servers reject the request, so pick by version.
    const fullSize = page.imageApiVersion === 3 ? 'max' : 'full';
    const sizeParam = quality === 'full' ? fullSize : `${quality},`;
    return `${page.serviceUrl}/full/${sizeParam}/0/default.${format}`;
  }

  if (page.url) {
    if (page.url.includes('/full/') && page.url.includes('/default.')) {
      let url = page.url;
      if (quality !== 'full') {
        url = url.replace(/\/full\/[^/]+\//, `/full/${quality},/`);
      }
      url = url.replace(/\/default\.\w+$/, `/default.${format}`);
      return url;
    }
    return page.url;
  }

  return null;
}

// Generate filename
function generateFilename(page, index, options) {
  const usePageNumbers = options.addPageNumbers !== false;
  const format = options.imageFormat || 'jpg';

  let filename = '';
  if (usePageNumbers) {
    const paddedNum = String(index + 1).padStart(3, '0');
    filename = `page_${paddedNum}`;
  } else {
    filename = (page.label || `page_${index + 1}`)
      .replace(/[<>:"\/\\|?*]/g, '') // keep punctuation; strip only illegal chars
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100) || `page_${index + 1}`;
  }

  return `${filename}.${format}`;
}

// Download file with retry logic
async function downloadFileWithRetry(url, filename, maxRetries = 3, baseDelay = 2000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await downloadFile(url, filename);
      return; // Success
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const waitTime = baseDelay * Math.pow(2, attempt);
        console.log(`Download failed, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError;
}

// Download a file using Chrome downloads API
function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: url,
        filename: filename,
        saveAs: false,
        conflictAction: 'uniquify'
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (downloadId === undefined) {
          reject(new Error('Download failed to start'));
          return;
        }

        // Monitor download
        const listener = (delta) => {
          if (delta.id === downloadId) {
            if (delta.state) {
              if (delta.state.current === 'complete') {
                chrome.downloads.onChanged.removeListener(listener);
                resolve();
              } else if (delta.state.current === 'interrupted') {
                chrome.downloads.onChanged.removeListener(listener);
                reject(new Error('Download interrupted'));
              }
            }
            if (delta.error) {
              chrome.downloads.onChanged.removeListener(listener);
              reject(new Error(delta.error.current));
            }
          }
        };

        chrome.downloads.onChanged.addListener(listener);

        // Timeout: don't blindly assume success — a hung request would
        // otherwise be counted as a completed (but truncated) file. Check the
        // real state and reject if it isn't actually complete, so the retry
        // logic can take over.
        setTimeout(() => {
          chrome.downloads.onChanged.removeListener(listener);
          chrome.downloads.search({ id: downloadId }, (items) => {
            const item = items && items[0];
            if (item && item.state === 'complete') {
              resolve();
            } else {
              reject(new Error('Download timed out before completing'));
            }
          });
        }, 120000);
      }
    );
  });
}

// Convert blob to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Get image dimensions from blob using OffscreenCanvas (available in service workers)
async function getImageDimensionsFromBlob(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch (e) {
    console.warn('Could not get image dimensions:', e);
    return { width: 800, height: 1000 }; // Default fallback
  }
}

// Create PDF using offscreen document
async function createPDFOffscreen() {
  try {
    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER'],
        justification: 'Generate PDF from images'
      });
    }

    // Send message to offscreen document to create PDF
    chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'generatePDF',
      imageData: downloadState.imageData,
      options: downloadState.options
    });

  } catch (error) {
    console.error('Error creating offscreen document:', error);
    // Fallback: notify popup to handle PDF creation
    notifyPopup('pdfFallback', {
      imageData: downloadState.imageData,
      options: downloadState.options
    });
  }
}

// Notify popup of events
function notifyPopup(event, data) {
  chrome.runtime.sendMessage({
    type: 'backgroundEvent',
    event: event,
    data: data
  }).catch(() => {
    // Popup might be closed, that's ok
  });
}

console.log('IIIF Manifest Downloader service worker started');
