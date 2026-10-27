/**
 * printHelper.ts
 * Universal cross-platform printing service for Mobile (Android, iOS) & Web.
 * 
 * - On Web (Chrome Android, Desktop, Safari): Uses an isolated print container & iframe
 *   so the browser's native print preview opens with only the target thermal receipt/invoice.
 * - On Native (Android APK, iOS): Uses Expo Print printAsync or paired direct printer.
 */

import { Platform } from 'react-native';
import * as Print from 'expo-print';

export interface UniversalPrintOptions {
  width?: number;
  printerUrl?: string;
  jobName?: string;
}

/**
 * Ensures global @media print CSS is present on Web so that printing always
 * displays ONLY the target invoice or document without application navigation or buttons.
 */
function ensureWebPrintStyle(): void {
  if (typeof document === 'undefined') return;
  const styleId = 'sfa-universal-print-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
      @media screen {
        #sfa-universal-print-container {
          display: none !important;
        }
      }
      @media print {
        body > *:not(#sfa-universal-print-container) {
          display: none !important;
        }
        #sfa-universal-print-container {
          display: block !important;
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          z-index: 999999 !important;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Universal print handler that triggers printing across Web and Native.
 */
export async function universalPrintHtml(
  html: string,
  options?: UniversalPrintOptions
): Promise<void> {
  if (Platform.OS === 'web' || (typeof window !== 'undefined' && typeof document !== 'undefined')) {
    return printHtmlOnWeb(html);
  }

  const printOptions: Print.PrintOptions = {
    html,
    width: options?.width,
  };
  if (options?.printerUrl) {
    printOptions.printerUrl = options.printerUrl;
  }

  try {
    await Print.printAsync(printOptions);
  } catch (err: any) {
    const msg = (err?.message || err?.reason || err?.toString() || '').toLowerCase();
    if (
      msg.includes('complete') ||
      msg.includes('incomplete') ||
      msg.includes('cancel') ||
      msg.includes('dismiss') ||
      msg.includes('abort') ||
      msg.includes('picker')
    ) {
      const e = new Error('Print cancelled by user.');
      e.name = 'PrintCancelled';
      throw e;
    }
    throw err;
  }
}

/**
 * Clean Web Printing via dedicated print container and hidden iframe.
 * Works seamlessly on Chrome Android, iOS Safari, and desktop browsers.
 */
function printHtmlOnWeb(html: string): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      ensureWebPrintStyle();

      // 1. Populate dedicated web print container for top-level window.print()
      let printContainer = document.getElementById('sfa-universal-print-container');
      if (!printContainer) {
        printContainer = document.createElement('div');
        printContainer.id = 'sfa-universal-print-container';
        document.body.appendChild(printContainer);
      }
      printContainer.innerHTML = html;

      // 2. Also prepare isolated hidden iframe
      let iframe = document.getElementById('sfa-universal-print-iframe') as HTMLIFrameElement;
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'sfa-universal-print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.top = '-9999px';
        iframe.style.left = '-9999px';
        iframe.style.width = '1px';
        iframe.style.height = '1px';
        iframe.style.border = 'none';
        iframe.style.opacity = '0.01';
        document.body.appendChild(iframe);
      }

      const frameDoc = iframe.contentWindow?.document || iframe.contentDocument;
      if (frameDoc) {
        frameDoc.open();
        frameDoc.write(html);
        frameDoc.close();

        const triggerIframePrint = () => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch (err) {
            console.warn('[printHelper] iframe.print failed, calling window.print:', err);
            try {
              window.print();
            } catch {}
          }
          cleanupAfterPrint();
          resolve();
        };

        if (iframe.contentWindow) {
          iframe.contentWindow.onload = () => setTimeout(triggerIframePrint, 150);
          setTimeout(triggerIframePrint, 350);
        } else {
          setTimeout(triggerIframePrint, 300);
        }
        return;
      }
    } catch (err) {
      console.warn('[printHelper] Web print setup error, falling back to window.print:', err);
    }

    try {
      window.print();
    } catch {}
    cleanupAfterPrint();
    resolve();
  });
}

function cleanupAfterPrint() {
  setTimeout(() => {
    try {
      const container = document.getElementById('sfa-universal-print-container');
      if (container) {
        container.innerHTML = '';
      }
    } catch {}
  }, 3000);
}
