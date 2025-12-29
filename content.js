// IIIF Manifest Downloader - Content Script
// Detects IIIF/Mirador viewers and extracts manifest URLs

(function() {
  'use strict';

  // Detect various IIIF viewers on the page
  function detectIIIFViewer() {
    const viewers = {
      mirador: false,
      universalViewer: false,
      divaJs: false,
      openSeadragon: false,
      generic: false
    };

    // Check for Mirador
    if (document.querySelector('[class*="mirador"]') ||
        document.querySelector('#mirador') ||
        document.querySelector('[class*="Mirador"]')) {
      viewers.mirador = true;
    }

    // Check for Universal Viewer
    if (document.querySelector('.uv') ||
        document.querySelector('[class*="universal-viewer"]') ||
        window.UV) {
      viewers.universalViewer = true;
    }

    // Check for Diva.js
    if (document.querySelector('.diva-outer') || window.diva) {
      viewers.divaJs = true;
    }

    // Check for OpenSeadragon
    if (document.querySelector('.openseadragon-container') || window.OpenSeadragon) {
      viewers.openSeadragon = true;
    }

    // Check for generic IIIF manifest references in page
    const pageText = document.body.innerHTML;
    if (pageText.includes('iiif') && (pageText.includes('manifest') || pageText.includes('Manifest'))) {
      viewers.generic = true;
    }

    return viewers;
  }

  // Extract manifest URL from various sources
  function extractManifestUrl() {
    const manifestUrls = [];

    // Method 1: Look in script tags for manifest URLs
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      const content = script.textContent || script.innerHTML;

      // Look for manifestId pattern (Mirador)
      const manifestIdMatch = content.match(/"manifestId"\s*:\s*"([^"]+)"/);
      if (manifestIdMatch) {
        manifestUrls.push(manifestIdMatch[1]);
      }

      // Look for manifest URL pattern
      const manifestMatch = content.match(/"manifest"\s*:\s*"([^"]+)"/i);
      if (manifestMatch) {
        manifestUrls.push(manifestMatch[1]);
      }

      // Look for IIIF manifest URLs directly
      const iiifMatch = content.match(/https?:\/\/[^"'\s]+\/iiif[^"'\s]*\/manifest[^"'\s]*/gi);
      if (iiifMatch) {
        manifestUrls.push(...iiifMatch);
      }

      // Look for manifest in Mirador config
      const miradorConfigMatch = content.match(/Mirador\.viewer\s*\(\s*(\{[\s\S]*?\})\s*\)/);
      if (miradorConfigMatch) {
        try {
          const configStr = miradorConfigMatch[1].replace(/'/g, '"');
          const config = JSON.parse(configStr);
          if (config.data) {
            config.data.forEach(item => {
              if (item.manifestUri) manifestUrls.push(item.manifestUri);
            });
          }
        } catch (e) {
          // JSON parse failed, try regex
          const uriMatch = miradorConfigMatch[1].match(/manifestUri['"]\s*:\s*['"]([^'"]+)/);
          if (uriMatch) manifestUrls.push(uriMatch[1]);
        }
      }
    });

    // Method 2: Look for manifest links in the DOM
    const manifestLinks = document.querySelectorAll('a[href*="manifest"], a[href*="iiif"]');
    manifestLinks.forEach(link => {
      if (link.href.includes('manifest')) {
        manifestUrls.push(link.href);
      }
    });

    // Method 3: Check data attributes
    const elementsWithData = document.querySelectorAll('[data-manifest], [data-manifest-url], [data-iiif-manifest]');
    elementsWithData.forEach(el => {
      const manifest = el.dataset.manifest || el.dataset.manifestUrl || el.dataset.iiifManifest;
      if (manifest) manifestUrls.push(manifest);
    });

    // Method 4: Look in link tags
    const linkTags = document.querySelectorAll('link[rel="alternate"][type="application/ld+json"], link[rel="manifest"]');
    linkTags.forEach(link => {
      if (link.href) manifestUrls.push(link.href);
    });

    // Method 5: Check meta tags
    const metaTags = document.querySelectorAll('meta[name*="iiif"], meta[property*="iiif"]');
    metaTags.forEach(meta => {
      if (meta.content && meta.content.includes('http')) {
        manifestUrls.push(meta.content);
      }
    });

    // Method 6: Look for JSON-LD scripts
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        if (data['@context'] && data['@context'].includes('iiif')) {
          // This might be the manifest itself embedded
          manifestUrls.push('embedded:' + JSON.stringify(data));
        }
      } catch (e) {
        // Not valid JSON
      }
    });

    // Deduplicate and filter valid URLs
    const uniqueUrls = [...new Set(manifestUrls)].filter(url => {
      return url && (url.startsWith('http') || url.startsWith('embedded:'));
    });

    return uniqueUrls;
  }

  // Get the current visible canvas/page info if available
  function getCurrentPageInfo() {
    // Try to get current page from Mirador
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      const canvasMatch = content.match(/"canvasId"\s*:\s*"([^"]+)"/);
      if (canvasMatch) {
        return { canvasId: canvasMatch[1] };
      }
    }
    return null;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkViewer') {
      const viewers = detectIIIFViewer();
      const manifestUrls = extractManifestUrl();
      const currentPage = getCurrentPageInfo();

      const hasViewer = Object.values(viewers).some(v => v);

      sendResponse({
        hasViewer: hasViewer,
        viewers: viewers,
        manifestUrls: manifestUrls,
        manifestUrl: manifestUrls[0] || null,
        currentPage: currentPage,
        pageUrl: window.location.href
      });
    }

    // Return true to indicate async response
    return true;
  });

  // Also try to extract manifest on page load and store it
  const viewers = detectIIIFViewer();
  const manifestUrls = extractManifestUrl();

  if (Object.values(viewers).some(v => v) && manifestUrls.length > 0) {
    console.log('[IIIF Downloader] Detected IIIF viewer with manifests:', manifestUrls);
  }
})();
