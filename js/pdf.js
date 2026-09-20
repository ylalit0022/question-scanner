/**
 * pdf.js — Browser-side PDF generation via jsPDF
 *
 * No server. No API. Runs 100% in the user's browser.
 * jsPDF is loaded from CDN at runtime.
 */

import { blobToURL } from './db.js';

/**
 * Generate and download a PDF for a project's questions.
 *
 * @param {Object} project   - { id, name, ... }
 * @param {Array}  questions - [{ id, text, croppedBlob, ... }]
 * @param {Object} settings  - PDF settings from IndexedDB
 */
export async function generatePDF(project, questions, settings) {
  const { jsPDF } = window.jspdf;

  const isPortrait = settings.orientation !== 'landscape';
  const pageSize   = settings.pageSize || 'A4';
  const margin     = Number(settings.marginMm) || 15;
  const fontSize   = Number(settings.fontSize) || 12;

  const doc = new jsPDF({
    orientation: isPortrait ? 'p' : 'l',
    unit:        'mm',
    format:      pageSize.toLowerCase(),
  });

  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const usableW = PAGE_W - margin * 2;

  // ── Line-spacing multiplier ──────────────────────────────
  const lineGaps = { compact: 5, normal: 7, spacious: 10 };
  const lineGap  = lineGaps[settings.lineSpacing] || 7;

  // ── Fonts / sizes ────────────────────────────────────────
  const headerFontSize = Math.min(fontSize + 2, 16);
  const bodyFontSize   = fontSize;
  const metaFontSize   = Math.max(fontSize - 2, 8);

  let yPos = margin;

  // ── Optional header ──────────────────────────────────────
  if (settings.headerText?.trim()) {
    doc.setFontSize(metaFontSize);
    doc.setTextColor(120, 120, 120);
    doc.text(settings.headerText.trim(), margin, yPos, { align: 'left' });
    doc.text(`${new Date().toLocaleDateString()}`, PAGE_W - margin, yPos, { align: 'right' });
    yPos += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, PAGE_W - margin, yPos);
    yPos += 8;
  }

  // ── Project title ────────────────────────────────────────
  doc.setFontSize(headerFontSize);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.text(project.name || 'Untitled Project', margin, yPos);
  yPos += headerFontSize * 0.5 + 2;

  doc.setFontSize(metaFontSize);
  doc.setTextColor(130, 130, 130);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${questions.length} question${questions.length !== 1 ? 's' : ''}  ·  Generated ${new Date().toLocaleDateString()}`,
    margin, yPos
  );
  yPos += 10;

  doc.setDrawColor(180, 180, 180);
  doc.line(margin, yPos, PAGE_W - margin, yPos);
  yPos += 8;

  // ── Questions loop ────────────────────────────────────────
  for (let i = 0; i < questions.length; i++) {
    const q       = questions[i];
    const qNum    = settings.showNumbers ? `${i + 1}.  ` : '';
    const qText   = q.text || '(no text)';
    const fullText = qNum + qText;

    doc.setFontSize(bodyFontSize);
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'normal');

    // Wrap text to usable width
    const lines = doc.splitTextToSize(fullText, usableW);
    const textH = lines.length * (bodyFontSize * 0.35 + 1.5);

    // Image dimensions
    let imgW = 0, imgH = 0;
    if (settings.includeImages && q.croppedBlob) {
      const imgSizes = { small: 35, medium: 55, large: 75, full: usableW };
      imgW = imgSizes[settings.imageSize] || 55;
      imgH = imgW; // will be adjusted after loading
    }

    // Estimate row height
    const answerH = settings.showAnswerLines
      ? (Number(settings.answerLines) || 3) * lineGap + 4
      : 0;

    const rowH = Math.max(textH + answerH + 6, imgH + 6);

    // Page break?
    if (yPos + rowH > PAGE_H - margin - 10) {
      doc.addPage();
      yPos = margin;
    }

    const rowStartY = yPos;

    // ── Image (if any) ──────────────────────────────────
    if (settings.includeImages && q.croppedBlob) {
      try {
        const dataURL = await blobToDataURL(q.croppedBlob);
        const imgInfo = await getImageDimensions(dataURL);
        const aspect  = imgInfo.height / imgInfo.width;
        imgH = imgW * aspect;

        const imgX = PAGE_W - margin - imgW;
        doc.addImage(dataURL, 'JPEG', imgX, yPos, imgW, imgH);
      } catch (err) {
        console.warn('Failed to embed image for question', i + 1, err);
      }
    }

    // ── Question text ────────────────────────────────────
    const textAreaW = settings.includeImages && q.croppedBlob
      ? usableW - imgW - 6
      : usableW;

    const wrappedLines = doc.splitTextToSize(fullText, textAreaW);
    doc.setFontSize(bodyFontSize);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.text(wrappedLines, margin, yPos + bodyFontSize * 0.35);

    const textBottom = yPos + wrappedLines.length * (bodyFontSize * 0.35 + 1.5);
    yPos = textBottom + 3;

    // ── Answer lines ─────────────────────────────────────
    if (settings.showAnswerLines) {
      const numLines = Number(settings.answerLines) || 3;
      doc.setDrawColor(210, 210, 210);
      for (let l = 0; l < numLines; l++) {
        const lineY = yPos + l * lineGap;
        doc.line(margin + 4, lineY, margin + textAreaW - 4, lineY);
      }
      yPos += numLines * lineGap + 2;
    }

    // Ensure yPos is at least below image
    const rowEndY = rowStartY + Math.max(imgH || 0, yPos - rowStartY);
    yPos = Math.max(yPos, rowEndY);

    // Question separator
    if (i < questions.length - 1) {
      yPos += 4;
      doc.setDrawColor(235, 235, 235);
      doc.line(margin, yPos, PAGE_W - margin, yPos);
      yPos += 6;
    } else {
      yPos += 8;
    }
  }

  // ── Optional footer ──────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(metaFontSize - 1);
    doc.setTextColor(170, 170, 170);

    if (settings.footerText?.trim()) {
      doc.text(settings.footerText.trim(), margin, PAGE_H - 8);
    }

    doc.text(`${p} / ${totalPages}`, PAGE_W - margin, PAGE_H - 8, { align: 'right' });
  }

  // ── Download ─────────────────────────────────────────────
  const fileName = `${slugify(project.name || 'export')}_${datestamp()}.pdf`;
  doc.save(fileName);

  return fileName;
}

// ── Helpers ───────────────────────────────────────────────────

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Blob read failed'));
    reader.readAsDataURL(blob);
  });
}

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function datestamp() {
  return new Date().toISOString().slice(0, 10);
}
