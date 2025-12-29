// IIIF Manifest Downloader - Popup Script

let manifestData = null;
let pages = [];
let documentTitle = 'document';
let progressPollInterval = null;

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const manifestUrlDisplay = document.getElementById('manifestUrlDisplay');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const manualInput = document.getElementById('manualInput');
const manualManifestUrl = document.getElementById('manualManifestUrl');
const loadManualBtn = document.getElementById('loadManualBtn');
const infoSection = document.getElementById('infoSection');
const pageCount = document.getElementById('pageCount');
const docTitle = document.getElementById('docTitle');
const pagesSection = document.getElementById('pagesSection');
const pagesHeaderCount = document.getElementById('pagesHeaderCount');
const pagesList = document.getElementById('pagesList');
const optionsSection = document.getElementById('optionsSection');
const downloadMode = document.getElementById('downloadMode');
const imageOptions = document.getElementById('imageOptions');
const pdfOptions = document.getElementById('pdfOptions');
const addPageNumbers = document.getElementById('addPageNumbers');
const imageQuality = document.getElementById('imageQuality');
const imageFormat = document.getElementById('imageFormat');
const pdfFilename = document.getElementById('pdfFilename');
const pdfPageSize = document.getElementById('pdfPageSize');
const progressSection = document.getElementById('progressSection');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const downloadBtn = document.getElementById('downloadBtn');
const cancelBtn = document.getElementById('cancelBtn');

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Set up download mode toggle
  downloadMode.addEventListener('change', toggleDownloadMode);

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  // Check if there's an ongoing download
  await checkExistingDownload();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Try to get viewer info from content script
    chrome.tabs.sendMessage(tab.id, { action: 'checkViewer' }, async (response) => {
      if (chrome.runtime.lastError) {
        showNotDetected('Content script not loaded. Enter manifest URL manually.');
        return;
      }

      if (response && response.hasViewer && response.manifestUrl) {
        showDetected(response);
        await loadManifest(response.manifestUrl);
      } else if (response && response.manifestUrls && response.manifestUrls.length > 0) {
        showDetected({ manifestUrl: response.manifestUrls[0] });
        await loadManifest(response.manifestUrls[0]);
      } else {
        showNotDetected('No IIIF viewer detected on this page.');
      }
    });
  } catch (error) {
    showError('Error initializing: ' + error.message);
  }
}

// Check if there's an existing download in progress
async function checkExistingDownload() {
  try {
    const state = await chrome.runtime.sendMessage({ action: 'getDownloadState' });

    if (state && state.isDownloading) {
      // Show progress UI
      showDownloadProgress(state);
      startProgressPolling();
    }
  } catch (e) {
    // Background not ready yet
  }
}

// Handle messages from background script
function handleBackgroundMessage(message) {
  if (message.type !== 'backgroundEvent') return;

  switch (message.event) {
    case 'downloadProgress':
      updateProgress(message.data);
      break;

    case 'downloadComplete':
      handleDownloadComplete(message.data);
      break;

    case 'pdfFallback':
      // Background couldn't create offscreen, create PDF in popup
      handlePDFFallback(message.data);
      break;
  }
}

// Show download progress UI
function showDownloadProgress(state) {
  downloadBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');
  progressSection.classList.remove('hidden');
  optionsSection.classList.add('hidden');
  hideError();
  successMessage.classList.add('hidden');

  updateProgress({
    currentIndex: state.currentIndex,
    total: state.total,
    status: 'downloading'
  });
}

// Start polling for progress updates
function startProgressPolling() {
  if (progressPollInterval) return;

  progressPollInterval = setInterval(async () => {
    try {
      const state = await chrome.runtime.sendMessage({ action: 'getDownloadState' });

      if (!state.isDownloading) {
        stopProgressPolling();
        handleDownloadComplete(state);
      } else {
        updateProgress({
          currentIndex: state.currentIndex,
          total: state.total,
          completed: state.completed,
          failed: state.failed
        });
      }
    } catch (e) {
      stopProgressPolling();
    }
  }, 500);
}

function stopProgressPolling() {
  if (progressPollInterval) {
    clearInterval(progressPollInterval);
    progressPollInterval = null;
  }
}

// Update progress UI
function updateProgress(data) {
  const { currentIndex, total, status, completed, failed } = data;
  const current = currentIndex + 1;
  const progress = (current / total) * 100;

  progressFill.style.width = `${progress}%`;
  progressPercent.textContent = `${Math.round(progress)}%`;

  if (status === 'creating_pdf') {
    progressText.textContent = 'Creating PDF...';
  } else {
    const comp = completed !== undefined ? completed : currentIndex;
    const fail = failed !== undefined ? failed : 0;
    progressText.textContent = `Downloading page ${current} of ${total}...`;
    if (fail > 0) {
      progressText.textContent += ` (${fail} failed)`;
    }
  }

  // Update page status indicators
  if (currentIndex !== undefined) {
    for (let i = 0; i <= currentIndex; i++) {
      updatePageStatus(i, i < currentIndex ? 'done' : 'downloading');
    }
  }
}

// Handle download completion
function handleDownloadComplete(data) {
  stopProgressPolling();

  const { completed, failed, total, cancelled } = data;

  downloadBtn.classList.remove('hidden');
  cancelBtn.classList.add('hidden');
  optionsSection.classList.remove('hidden');

  // Update all page statuses
  for (let i = 0; i < total; i++) {
    updatePageStatus(i, i < completed ? 'done' : 'error');
  }

  if (cancelled) {
    progressText.textContent = `Download cancelled. ${completed} of ${total} completed.`;
  } else if (failed > 0) {
    progressText.textContent = `Done! ${completed} completed, ${failed} failed.`;
    showError(`${failed} page(s) failed to process.`);
  } else {
    progressFill.style.width = '100%';
    progressPercent.textContent = '100%';
    progressText.textContent = `All ${completed} pages completed successfully!`;
    showSuccess(downloadMode.value === 'pdf' ? 'PDF downloaded successfully!' : 'All images downloaded successfully!');
  }
}

// Handle PDF fallback (create in popup when offscreen fails)
async function handlePDFFallback(data) {
  const { imageData, options } = data;

  progressText.textContent = 'Creating PDF in popup...';

  try {
    await createPDFInPopup(imageData, options);
    handleDownloadComplete({
      completed: imageData.length,
      failed: 0,
      total: imageData.length
    });
  } catch (error) {
    showError('Failed to create PDF: ' + error.message);
    handleDownloadComplete({
      completed: 0,
      failed: imageData.length,
      total: imageData.length
    });
  }
}

// Create PDF directly in popup (fallback)
async function createPDFInPopup(imageData, options) {
  const pageSize = options.pdfPageSize || 'auto';
  let pdf = null;

  for (let i = 0; i < imageData.length; i++) {
    const img = imageData[i];

    if (i === 0) {
      if (pageSize === 'auto') {
        const widthMm = (img.width / 96) * 25.4;
        const heightMm = (img.height / 96) * 25.4;
        pdf = new jspdf.jsPDF({
          orientation: widthMm > heightMm ? 'landscape' : 'portrait',
          unit: 'mm',
          format: [widthMm, heightMm]
        });
      } else {
        pdf = new jspdf.jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: pageSize
        });
      }
    } else {
      if (pageSize === 'auto') {
        const widthMm = (img.width / 96) * 25.4;
        const heightMm = (img.height / 96) * 25.4;
        pdf.addPage([widthMm, heightMm], widthMm > heightMm ? 'landscape' : 'portrait');
      } else {
        pdf.addPage();
      }
    }

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    let imgWidth, imgHeight;
    const imgRatio = img.width / img.height;
    const pageRatio = pdfWidth / pdfHeight;

    if (pageSize === 'auto') {
      imgWidth = pdfWidth;
      imgHeight = pdfHeight;
    } else {
      const margin = 10;
      const maxWidth = pdfWidth - (margin * 2);
      const maxHeight = pdfHeight - (margin * 2);

      if (imgRatio > pageRatio) {
        imgWidth = maxWidth;
        imgHeight = maxWidth / imgRatio;
      } else {
        imgHeight = maxHeight;
        imgWidth = maxHeight * imgRatio;
      }
    }

    const x = pageSize === 'auto' ? 0 : (pdfWidth - imgWidth) / 2;
    const y = pageSize === 'auto' ? 0 : (pdfHeight - imgHeight) / 2;

    pdf.addImage(img.base64, 'JPEG', x, y, imgWidth, imgHeight);
  }

  let filename = options.pdfFilename || 'document.pdf';
  if (!filename.endsWith('.pdf')) {
    filename += '.pdf';
  }

  pdf.save(filename);
}

function toggleDownloadMode() {
  const mode = downloadMode.value;
  if (mode === 'pdf') {
    imageOptions.classList.add('hidden');
    pdfOptions.classList.remove('hidden');
    downloadBtn.textContent = 'Download as PDF';
  } else {
    imageOptions.classList.remove('hidden');
    pdfOptions.classList.add('hidden');
    downloadBtn.textContent = 'Download All Pages';
  }
}

function showDetected(response) {
  statusDot.className = 'status-dot detected';
  statusText.className = 'status-text detected';
  statusText.textContent = 'IIIF Viewer Detected!';

  if (response.manifestUrl) {
    manifestUrlDisplay.textContent = response.manifestUrl;
    manifestUrlDisplay.classList.remove('hidden');
  }
}

function showNotDetected(message) {
  statusDot.className = 'status-dot not-detected';
  statusText.className = 'status-text not-detected';
  statusText.textContent = message;
  manualInput.classList.remove('hidden');
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
  successMessage.classList.add('hidden');
}

function hideError() {
  errorMessage.classList.add('hidden');
}

function showSuccess(message) {
  successMessage.textContent = message || 'Download complete!';
  successMessage.classList.remove('hidden');
  errorMessage.classList.add('hidden');
}

// Load manifest from URL
async function loadManifest(manifestUrl) {
  try {
    hideError();
    statusText.textContent = 'Loading manifest...';

    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    manifestData = await response.json();
    pages = parseManifest(manifestData);

    if (pages.length === 0) {
      throw new Error('No pages found in manifest');
    }

    // Update UI
    statusText.textContent = 'IIIF Viewer Detected!';
    pageCount.textContent = pages.length;
    pagesHeaderCount.textContent = `${pages.length} pages`;

    // Get document title
    const title = getManifestTitle(manifestData);
    documentTitle = title || 'document';
    docTitle.textContent = documentTitle;

    // Set default PDF filename
    const safeFilename = documentTitle.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, '_').substring(0, 50);
    pdfFilename.value = `${safeFilename}.pdf`;

    // Render pages list
    renderPagesList();

    // Show sections
    infoSection.classList.remove('hidden');
    pagesSection.classList.remove('hidden');
    optionsSection.classList.remove('hidden');
    downloadBtn.classList.remove('hidden');

  } catch (error) {
    showError('Error loading manifest: ' + error.message);
    console.error('Manifest load error:', error);
  }
}

// Parse IIIF manifest (supports v2 and v3)
function parseManifest(manifest) {
  const parsedPages = [];

  // IIIF Presentation API v3
  if (manifest.items && Array.isArray(manifest.items)) {
    manifest.items.forEach((canvas, index) => {
      try {
        let imageUrl = null;
        let serviceUrl = null;

        if (canvas.items && canvas.items[0] && canvas.items[0].items) {
          const annotation = canvas.items[0].items[0];
          if (annotation && annotation.body) {
            const body = annotation.body;
            imageUrl = body.id || body['@id'];

            if (body.service) {
              const service = Array.isArray(body.service) ? body.service[0] : body.service;
              serviceUrl = service.id || service['@id'];
            }
          }
        }

        if (imageUrl || serviceUrl) {
          parsedPages.push({
            page: index + 1,
            label: extractLabel(canvas.label) || `Page ${index + 1}`,
            url: imageUrl,
            serviceUrl: serviceUrl,
            width: canvas.width,
            height: canvas.height
          });
        }
      } catch (e) {
        console.warn(`Error parsing canvas ${index}:`, e);
      }
    });
  }
  // IIIF Presentation API v2
  else if (manifest.sequences && manifest.sequences[0] && manifest.sequences[0].canvases) {
    manifest.sequences[0].canvases.forEach((canvas, index) => {
      try {
        let imageUrl = null;
        let serviceUrl = null;

        if (canvas.images && canvas.images[0] && canvas.images[0].resource) {
          const resource = canvas.images[0].resource;
          imageUrl = resource['@id'] || resource.id;

          if (resource.service) {
            const service = Array.isArray(resource.service) ? resource.service[0] : resource.service;
            serviceUrl = service['@id'] || service.id;
          }
        }

        if (imageUrl || serviceUrl) {
          parsedPages.push({
            page: index + 1,
            label: canvas.label || `Page ${index + 1}`,
            url: imageUrl,
            serviceUrl: serviceUrl,
            width: canvas.width,
            height: canvas.height
          });
        }
      } catch (e) {
        console.warn(`Error parsing canvas ${index}:`, e);
      }
    });
  }

  return parsedPages;
}

function extractLabel(label) {
  if (!label) return null;
  if (typeof label === 'string') return label;
  if (label.none && Array.isArray(label.none)) return label.none[0];
  if (label.en && Array.isArray(label.en)) return label.en[0];
  if (label['@value']) return label['@value'];
  return null;
}

function getManifestTitle(manifest) {
  if (manifest.label) {
    return extractLabel(manifest.label);
  }
  if (manifest.metadata) {
    const titleMeta = manifest.metadata.find(m =>
      m.label && (m.label.toLowerCase() === 'title' || extractLabel(m.label)?.toLowerCase() === 'title')
    );
    if (titleMeta) {
      return extractLabel(titleMeta.value);
    }
  }
  return null;
}

function renderPagesList() {
  pagesList.innerHTML = '';

  pages.forEach((page, index) => {
    const div = document.createElement('div');
    div.className = 'page-item';
    div.innerHTML = `
      <div class="page-num">${page.page}</div>
      <div class="page-label" title="${page.label}">${page.label}</div>
      <div class="page-status" id="page-status-${index}"></div>
    `;
    pagesList.appendChild(div);
  });
}

function updatePageStatus(index, status) {
  const statusEl = document.getElementById(`page-status-${index}`);
  if (statusEl) {
    switch (status) {
      case 'downloading':
        statusEl.textContent = '...';
        break;
      case 'done':
        statusEl.textContent = '';
        break;
      case 'error':
        statusEl.textContent = '';
        break;
      default:
        statusEl.textContent = '';
    }
  }
}

// Start download (sends to background)
async function startDownload() {
  if (pages.length === 0) return;

  hideError();
  successMessage.classList.add('hidden');

  const options = {
    mode: downloadMode.value,
    imageQuality: imageQuality.value,
    imageFormat: imageFormat.value,
    addPageNumbers: addPageNumbers.checked,
    pdfFilename: pdfFilename.value,
    pdfPageSize: pdfPageSize.value
  };

  // Show progress UI
  downloadBtn.classList.add('hidden');
  cancelBtn.classList.remove('hidden');
  progressSection.classList.remove('hidden');
  optionsSection.classList.add('hidden');
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  progressText.textContent = 'Starting download...';

  // Reset page statuses
  pages.forEach((_, i) => updatePageStatus(i, ''));

  try {
    // Send download request to background
    await chrome.runtime.sendMessage({
      action: 'startDownload',
      pages: pages,
      options: options
    });

    // Start polling for progress
    startProgressPolling();
  } catch (error) {
    showError('Failed to start download: ' + error.message);
    downloadBtn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
    optionsSection.classList.remove('hidden');
  }
}

// Cancel download
async function cancelDownload() {
  try {
    await chrome.runtime.sendMessage({ action: 'cancelDownload' });
    progressText.textContent = 'Cancelling...';
  } catch (e) {
    console.error('Error cancelling:', e);
  }
}

// Event Listeners
downloadBtn.addEventListener('click', startDownload);
cancelBtn.addEventListener('click', cancelDownload);

loadManualBtn.addEventListener('click', async () => {
  const url = manualManifestUrl.value.trim();
  if (url) {
    manifestUrlDisplay.textContent = url;
    manifestUrlDisplay.classList.remove('hidden');
    await loadManifest(url);
  }
});

manualManifestUrl.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter') {
    const url = manualManifestUrl.value.trim();
    if (url) {
      manifestUrlDisplay.textContent = url;
      manifestUrlDisplay.classList.remove('hidden');
      await loadManifest(url);
    }
  }
});

// Cleanup on popup close
window.addEventListener('beforeunload', () => {
  stopProgressPolling();
});
