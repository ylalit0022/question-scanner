/**
 * crop.js — Image capture & Cropper.js integration
 * All image processing happens inside the browser via Canvas API.
 */

import { canvasToBlob } from './db.js';

let cropperInstance = null;

/**
 * Initialise Cropper.js on an <img> element.
 */
export function initCropper(imgEl, options = {}) {
  destroyCropper();
  cropperInstance = new Cropper(imgEl, {
    viewMode: 1,
    autoCropArea: 0.85,
    movable: true,
    zoomable: true,
    rotatable: true,
    scalable: true,
    responsive: true,
    background: true,
    guides: true,
    center: true,
    highlight: true,
    dragMode: 'crop',
    cropBoxMovable: true,
    cropBoxResizable: true,
    toggleDragModeOnDblclick: true,
    ...options,
  });
  return cropperInstance;
}

export function destroyCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
}

/** Export getCropper so app.js can access the current instance */
export function getCropper() {
  return cropperInstance;
}

/**
 * Extract the cropped region as a Blob (JPEG).
 * @param {number} maxDim — Max pixel dimension (to limit stored size).
 */
export async function getCroppedBlob(maxDim = 1600) {
  if (!cropperInstance) throw new Error('No active cropper');
  const canvas = cropperInstance.getCroppedCanvas({
    maxWidth:  maxDim,
    maxHeight: maxDim,
    fillColor: '#fff',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });
  return canvasToBlob(canvas, 0.88);
}

/**
 * Generate a small thumbnail Blob from the full image element.
 */
export async function getThumbBlob(imgEl, size = 120) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const s  = Math.min(imgEl.naturalWidth, imgEl.naturalHeight);
  const sx = (imgEl.naturalWidth  - s) / 2;
  const sy = (imgEl.naturalHeight - s) / 2;
  ctx.drawImage(imgEl, sx, sy, s, s, 0, 0, size, size);

  return canvasToBlob(canvas, 0.75);
}

/**
 * Read a File object as a data-URL (for Cropper.js src).
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

export function rotateCropper(deg) {
  cropperInstance?.rotate(deg);
}

export function flipCropper(axis) {
  if (!cropperInstance) return;
  const d = cropperInstance.getData();
  if (axis === 'h') cropperInstance.scaleX(-(d.scaleX || 1));
  else               cropperInstance.scaleY(-(d.scaleY || 1));
}

export function resetCropper() {
  cropperInstance?.reset();
}

/** Zoom in/out helpers */
export function zoomCropper(ratio) {
  cropperInstance?.zoom(ratio);
}
