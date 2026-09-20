/**
 * pdf.js — Browser-side PDF generation via jsPDF
 *
 * PDF mein sirf cropped images show hongi — ek row mein ek image.
 * Koi text, description ya answer lines nahi.
 */

import { blobToURL } from './db.js';

export async function generatePDF(project, questions, settings) {
  const { jsPDF } = window.jspdf;

  const isPortrait = settings.orientation !== 'landscape';
  const pageSize   = settings.pageSize || 'A4';
  const margin     = Number(settings.marginMm) || 15;

  const doc = new jsPDF({
    orientation: isPortrait ? 'p' : 'l',
    unit:        'mm',
    format:      pageSize.toLowerCase(),
  });

  const PAGE_W  = doc.internal.pageSize.getWidth();
  const PAGE_H  = doc.internal.pageSize.getHeight();
  const usableW = PAGE_W - margin * 2;

  let yPos = margin;

  // ── Optional header ──────────────────────────────────────
  if (settings.headerText?.trim()) {
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(settings.headerText.trim(), margin, yPos, { align: 'left' });
    doc.text(new Date().toLocaleDateString(), PAGE_W - margin, yPos, { align: 'right' });
    yPos += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, PAGE_W - margin, yPos);
    yPos += 7;
  }

  // ── Project title ────────────────────────────────────────
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.text(project.name || 'Untitled Project', margin, yPos);
  yPos += 7;

  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${questions.length} question${questions.length !== 1 ? 's' : ''}  ·  ${new Date().toLocaleDateString()}`,
    margin, yPos
  );
  yPos += 6;

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, yPos, PAGE_W - margin, yPos);
  yPos += 8;

  // ── Images — one per row ─────────────────────────────────
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    if (!q.croppedBlob) continue; // skip if no image

    try {
      const dataURL = await blobToDataURL(q.croppedBlob);
      const imgInfo = await getImageDimensions(dataURL);

      // Scale image to fit full usable width
      const aspect = imgInfo.height / imgInfo.width;
      const imgW   = usableW;
      const imgH   = imgW * aspect;

      // Page break check
      if (yPos + imgH > PAGE_H - margin - 10) {
        doc.addPage();
        yPos = margin;
      }

      // Question number (small, top-left corner of image)
      if (settings.showNumbers) {
        doc.setFontSize(8);
        doc.setTextColor(160, 160, 160);
        doc.setFont('helvetica', 'normal');
        doc.text(`Q${i + 1}`, margin, yPos + 3);
        // Draw image slightly indented for number
        doc.addImage(dataURL, 'JPEG', margin, yPos + 5, imgW, imgH);
        yPos += imgH + 5;
      } else {
        doc.addImage(dataURL, 'JPEG', margin, yPos, imgW, imgH);
        yPos += imgH;
      }

      // Gap between images
      if (i < questions.length - 1) {
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, yPos + 3, PAGE_W - margin, yPos + 3);
        yPos += 10;
      } else {
        yPos += 8;
      }

    } catch (err) {
      console.warn('Image embed failed for Q' + (i + 1), err);
    }
  }

  // ── Footer ───────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);

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
