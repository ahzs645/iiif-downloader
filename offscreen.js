// IIIF Manifest Downloader - Offscreen Document Script
// Handles PDF generation in a DOM context

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target !== 'offscreen') return;

  if (request.action === 'generatePDF') {
    generatePDF(request.imageData, request.options)
      .then(() => {
        // Notify background that PDF is complete
        chrome.runtime.sendMessage({ action: 'pdfComplete' });
      })
      .catch(error => {
        console.error('PDF generation error:', error);
        chrome.runtime.sendMessage({
          action: 'pdfComplete',
          error: error.message
        });
      });
  }
});

async function generatePDF(imageData, options) {
  const pageSize = options.pdfPageSize || 'auto';
  let pdf = null;

  for (let i = 0; i < imageData.length; i++) {
    const img = imageData[i];

    // Initialize PDF with first image dimensions or specified size
    if (i === 0) {
      if (pageSize === 'auto') {
        // Use image dimensions (convert pixels to mm, assuming 96 DPI)
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
      // Add new page
      if (pageSize === 'auto') {
        const widthMm = (img.width / 96) * 25.4;
        const heightMm = (img.height / 96) * 25.4;
        pdf.addPage([widthMm, heightMm], widthMm > heightMm ? 'landscape' : 'portrait');
      } else {
        pdf.addPage();
      }
    }

    // Get page dimensions
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    // Calculate image dimensions to fit page
    let imgWidth, imgHeight;
    const imgRatio = img.width / img.height;
    const pageRatio = pdfWidth / pdfHeight;

    if (pageSize === 'auto') {
      // Use full page
      imgWidth = pdfWidth;
      imgHeight = pdfHeight;
    } else {
      // Fit image within page with margins
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

    // Center image on page
    const x = pageSize === 'auto' ? 0 : (pdfWidth - imgWidth) / 2;
    const y = pageSize === 'auto' ? 0 : (pdfHeight - imgHeight) / 2;

    // Add image to PDF
    pdf.addImage(img.base64, 'JPEG', x, y, imgWidth, imgHeight);
  }

  // Generate filename
  let filename = options.pdfFilename || 'document.pdf';
  if (!filename.endsWith('.pdf')) {
    filename += '.pdf';
  }

  // Save the PDF - this triggers a download
  pdf.save(filename);
}

console.log('IIIF Downloader offscreen document loaded');
