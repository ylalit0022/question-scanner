/**
 * app.js — Main application controller
 *
 * Fixes:
 *  - Save Question button now works (getCropper was not exported before)
 *  - Camera & Gallery as separate buttons
 *  - Crop visibility enhanced
 *  - Zoom controls added
 *  - Preview cropped image before saving
 *  - Search questions feature
 *  - Dark/brightness filter for scanned images
 */

import {
  openDB,
  saveProject, getProject, getAllProjects, deleteProject,
  saveQuestion, getQuestion, getQuestionsForProject, deleteQuestion, reorderQuestions,
  getSettings, saveSettings,
  blobToURL, dataURLtoBlob,
} from './db.js';

import {
  initCropper, destroyCropper, getCropper, getCroppedBlob, getThumbBlob,
  readFileAsDataURL, rotateCropper, flipCropper, resetCropper, zoomCropper,
} from './crop.js';

import { generatePDF } from './pdf.js';

// ── State ─────────────────────────────────────────────────────
const state = {
  currentProjectId: null,
  editingQuestionId: null,
  activeCropDataURL: null,
  sortable: null,
  objectURLs: [],
  searchQuery: '',
};

// ── DOM refs ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screen = name => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name);
  });
};

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  setupNav();
  setupHomeScreen();
  setupCaptureScreen();
  setupQuestionsScreen();
  setupPdfScreen();
  showHomeScreen();

  document.getElementById('app').addEventListener('gohome', () => showHomeScreen());
  window._goHome = () => showHomeScreen();
});

// ── Navigation ────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.screen;
      if (!target) return;
      if ((target === 'capture' || target === 'questions' || target === 'pdf') && !state.currentProjectId) {
        showToast('Pehle ek project open karein', 'info');
        return;
      }
      screen(target);
      if (target === 'questions') renderQuestionsList();
      if (target === 'pdf') renderPdfScreen();
      if (target === 'capture') resetCaptureScreen();
    });
  });
}

// ════════════════════════════════════════════════════════════════
// HOME SCREEN
// ════════════════════════════════════════════════════════════════

function setupHomeScreen() {
  $('btn-new-project').addEventListener('click', () => openNewProjectModal());
}

async function showHomeScreen() {
  screen('home');
  await renderProjectList();
}

async function renderProjectList() {
  const list = $('project-list');
  const projects = await getAllProjects();

  if (projects.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <strong>Koi project nahi</strong>
        <p>Nayi project banayein aur questions scan karein.</p>
      </div>`;
    return;
  }

  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  list.innerHTML = projects.map(p => `
    <div class="project-card" data-id="${p.id}">
      <div class="project-card-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
      <div class="project-card-body">
        <div class="project-card-name">${escHtml(p.name)}</div>
        <div class="project-card-meta">
          <span>${p.questionCount || 0} question${(p.questionCount || 0) !== 1 ? 's' : ''}</span>
          <span>${relDate(p.updatedAt)}</span>
        </div>
      </div>
      <div class="project-card-actions">
        <button class="btn btn-icon btn-sm btn-danger-soft" data-delete-project="${p.id}" title="Delete Project">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
        <svg class="project-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-delete-project]')) return;
      openProject(card.dataset.id);
    });
  });

  list.querySelectorAll('[data-delete-project]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      confirmDeleteProject(btn.dataset.deleteProject);
    });
  });
}

function openNewProjectModal() {
  showModal('modal-project', async () => {
    const name = $('input-project-name').value.trim();
    if (!name) { showToast('Project ka naam zaroor daalen', 'error'); return false; }

    const project = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      questionCount: 0,
    };
    await saveProject(project);
    await renderProjectList();
    await openProject(project.id);
    return true;
  });
  $('input-project-name').value = '';
  setTimeout(() => $('input-project-name').focus(), 80);
}

async function openProject(id) {
  const project = await getProject(id);
  if (!project) { showToast('Project nahi mila', 'error'); return; }
  state.currentProjectId = id;
  $('header-project-name').textContent = project.name;
  $('header-project-name').style.display = 'inline';
  screen('questions');
  renderQuestionsList();
}

async function confirmDeleteProject(id) {
  const project = await getProject(id);
  if (!project) return;
  showConfirm(`"${escHtml(project.name)}" delete karein? Iske saare questions hata diye jayenge.`, async () => {
    await deleteProject(id);
    if (state.currentProjectId === id) {
      state.currentProjectId = null;
      $('header-project-name').style.display = 'none';
    }
    await renderProjectList();
    showToast('Project delete ho gaya', 'info');
  });
}

// ════════════════════════════════════════════════════════════════
// QUESTIONS SCREEN
// ════════════════════════════════════════════════════════════════

function setupQuestionsScreen() {
  $('btn-add-question').addEventListener('click', () => {
    state.editingQuestionId = null;
    screen('capture');
    resetCaptureScreen();
  });

  // Search
  $('questions-search').addEventListener('input', e => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderQuestionsList();
  });
}

async function renderQuestionsList() {
  if (!state.currentProjectId) return;

  const project   = await getProject(state.currentProjectId);
  let questions   = await getQuestionsForProject(state.currentProjectId);
  const list      = $('questions-list');

  $('questions-count').textContent = `${questions.length} question${questions.length !== 1 ? 's' : ''}`;

  if (project && project.questionCount !== questions.length) {
    project.questionCount = questions.length;
    await saveProject(project);
  }

  // Apply search filter
  if (state.searchQuery) {
    questions = questions.filter(q =>
      (q.text || '').toLowerCase().includes(state.searchQuery)
    );
  }

  state.objectURLs.forEach(u => URL.revokeObjectURL(u));
  state.objectURLs.length = 0;

  if (questions.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <strong>${state.searchQuery ? 'Koi result nahi mila' : 'Koi question nahi'}</strong>
        <p>${state.searchQuery ? 'Dusra search term try karein.' : '+ button dabayein aur pehla question add karein.'}</p>
      </div>`;

    if (state.sortable) { state.sortable.destroy(); state.sortable = null; }
    return;
  }

  list.innerHTML = questions.map((q, idx) => {
    let thumbSrc = '';
    if (q.thumbBlob) {
      thumbSrc = blobToURL(q.thumbBlob);
      state.objectURLs.push(thumbSrc);
    }

    return `
      <div class="question-item" data-id="${q.id}">
        <span class="drag-handle" title="Drag to reorder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="16" y2="6"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
            <line x1="8" y1="18" x2="16" y2="18"/>
          </svg>
        </span>
        <div class="question-body">
          <div class="question-num">Q${idx + 1}</div>
          <div class="question-text">${escHtml(q.text || '(koi text nahi)')}</div>
        </div>
        ${thumbSrc ? `<img class="question-thumb" src="${thumbSrc}" alt="Question image" data-preview="${escHtml(thumbSrc)}">` : ''}
        <div class="question-actions">
          <button class="btn btn-icon btn-sm" data-action="edit" data-id="${q.id}" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn btn-icon btn-sm" data-action="delete" data-id="${q.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');

  // Bind action buttons
  list.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); editQuestion(btn.dataset.id); });
  });
  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteQuestion(btn.dataset.id); });
  });

  // Image preview on click
  list.querySelectorAll('.question-thumb').forEach(img => {
    img.addEventListener('click', () => showImagePreview(img.src));
  });

  // Sortable
  if (state.sortable) { state.sortable.destroy(); state.sortable = null; }
  if (window.Sortable && !state.searchQuery) {
    state.sortable = Sortable.create(list, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: async () => {
        const ids = [...list.querySelectorAll('.question-item')].map(el => el.dataset.id);
        await reorderQuestions(state.currentProjectId, ids);
      },
    });
  }
}

async function editQuestion(id) {
  state.editingQuestionId = id;
  const q = await getQuestion(id);
  if (!q) return;
  showModal('modal-question-text', async () => {
    const text = $('input-question-text').value.trim();
    if (!text) { showToast('Question text zaroor chahiye', 'error'); return false; }
    q.text = text;
    await saveQuestion(q);
    await renderQuestionsList();
    const project = await getProject(state.currentProjectId);
    if (project) await saveProject(project);
    return true;
  });
  $('input-question-text').value = q.text || '';
  setTimeout(() => $('input-question-text').focus(), 80);
}

async function confirmDeleteQuestion(id) {
  showConfirm('Yeh question delete karein? Yeh action undo nahi ho sakta.', async () => {
    await deleteQuestion(id);
    await renderQuestionsList();
    showToast('Question delete ho gaya', 'info');
  });
}

// Image full preview modal
function showImagePreview(src) {
  let overlay = $('img-preview-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'img-preview-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;
      display:flex;align-items:center;justify-content:center;cursor:zoom-out;
      padding:20px;
    `;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<img src="${src}" style="max-width:100%;max-height:90dvh;border-radius:8px;box-shadow:0 4px 30px rgba(0,0,0,.6);">`;
}

// ════════════════════════════════════════════════════════════════
// CAPTURE SCREEN
// ════════════════════════════════════════════════════════════════

function setupCaptureScreen() {
  const cameraInput  = $('camera-input');
  const galleryInput = $('gallery-input');
  const captureZone  = $('capture-zone');

  // Camera button — opens camera directly
  $('btn-camera').addEventListener('click', () => cameraInput.click());

  // Gallery button — opens file picker (no camera)
  $('btn-gallery').addEventListener('click', () => galleryInput.click());

  // Also allow clicking the entire zone
  captureZone.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    galleryInput.click();
  });

  cameraInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    cameraInput.value = '';
  });

  galleryInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    galleryInput.value = '';
  });

  // Drag-and-drop
  captureZone.addEventListener('dragover', e => {
    e.preventDefault();
    captureZone.classList.add('drag-over');
  });
  captureZone.addEventListener('dragleave', () => captureZone.classList.remove('drag-over'));
  captureZone.addEventListener('drop', e => {
    e.preventDefault();
    captureZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  });

  // Cropper tool buttons
  $('btn-rotate-cw').addEventListener('click',  () => rotateCropper(90));
  $('btn-rotate-ccw').addEventListener('click', () => rotateCropper(-90));
  $('btn-flip-h').addEventListener('click',     () => flipCropper('h'));
  $('btn-flip-v').addEventListener('click',     () => flipCropper('v'));
  $('btn-crop-reset').addEventListener('click', () => resetCropper());
  $('btn-zoom-in').addEventListener('click',    () => zoomCropper(0.1));
  $('btn-zoom-out').addEventListener('click',   () => zoomCropper(-0.1));

  // Brightness / contrast filter
  $('range-brightness').addEventListener('input', applyImageFilter);
  $('range-contrast').addEventListener('input', applyImageFilter);

  // Save
  $('btn-save-crop').addEventListener('click', saveCroppedQuestion);

  // Cancel
  $('btn-cancel-crop').addEventListener('click', () => {
    destroyCropper();
    screen('questions');
  });
}

function applyImageFilter() {
  const brightness = $('range-brightness')?.value || 100;
  const contrast   = $('range-contrast')?.value || 100;
  const img = $('crop-image');
  if (img) {
    img.style.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  }
}

async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Sirf image file select karein', 'error');
    return;
  }

  showLoading('Image load ho rahi hai…');
  try {
    const dataURL = await readFileAsDataURL(file);
    state.activeCropDataURL = dataURL;

    const cropImg = $('crop-image');
    cropImg.src = dataURL;
    cropImg.style.filter = '';

    // Reset sliders
    if ($('range-brightness')) $('range-brightness').value = 100;
    if ($('range-contrast'))   $('range-contrast').value   = 100;

    $('capture-zone').style.display     = 'none';
    $('cropper-wrapper').style.display  = 'block';
    $('crop-controls').style.display    = 'flex';
    $('crop-filter-row').style.display  = 'flex';
    $('crop-save-row').style.display    = 'flex';

    cropImg.onload = () => {
      initCropper(cropImg);
      hideLoading();
    };
  } catch (err) {
    hideLoading();
    showToast('Image load karne mein problem aayi', 'error');
    console.error(err);
  }
}

async function saveCroppedQuestion() {
  const cropper = getCropper();
  if (!cropper) { showToast('Pehle ek image select karein', 'error'); return; }
  if (!state.currentProjectId) { showToast('Koi active project nahi', 'error'); return; }

  showModal('modal-question-text', async () => {
    const text = $('input-question-text').value.trim();
    if (!text) { showToast('Question text zaroor chahiye', 'error'); return false; }

    showLoading('Question save ho raha hai…');
    try {
      const croppedBlob = await getCroppedBlob(1600);

      const canvas   = cropper.getCroppedCanvas({ maxWidth: 160, maxHeight: 160 });
      const thumbBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.7));

      const question = {
        id:        state.editingQuestionId || crypto.randomUUID(),
        projectId: state.currentProjectId,
        text,
        croppedBlob,
        thumbBlob,
        createdAt: Date.now(),
        order:     Date.now(),
      };

      await saveQuestion(question);

      const project = await getProject(state.currentProjectId);
      if (project) {
        const qs = await getQuestionsForProject(state.currentProjectId);
        project.questionCount = qs.length;
        await saveProject(project);
      }

      destroyCropper();
      resetCaptureScreen();
      screen('questions');
      await renderQuestionsList();
      showToast('Question save ho gaya ✓', 'success');
    } catch (err) {
      console.error(err);
      showToast('Question save karne mein problem aayi', 'error');
    } finally {
      hideLoading();
    }
    return true;
  });

  $('input-question-text').value = '';
  setTimeout(() => $('input-question-text').focus(), 80);
}

function resetCaptureScreen() {
  destroyCropper();
  state.activeCropDataURL = null;
  $('capture-zone').style.display    = 'block';
  $('cropper-wrapper').style.display = 'none';
  $('crop-controls').style.display   = 'none';
  $('crop-filter-row').style.display = 'none';
  $('crop-save-row').style.display   = 'none';
  $('crop-image').src = '';
  $('crop-image').style.filter = '';
  if ($('range-brightness')) $('range-brightness').value = 100;
  if ($('range-contrast'))   $('range-contrast').value   = 100;
}

// ════════════════════════════════════════════════════════════════
// PDF SCREEN
// ════════════════════════════════════════════════════════════════

function setupPdfScreen() {
  $('btn-generate-pdf').addEventListener('click', handleGeneratePDF);

  const settingsFields = [
    'pdf-page-size', 'pdf-orientation', 'pdf-font-size',
    'pdf-include-images', 'pdf-image-size', 'pdf-line-spacing',
    'pdf-show-numbers', 'pdf-show-answers', 'pdf-answer-lines',
    'pdf-header', 'pdf-footer', 'pdf-margin',
  ];
  settingsFields.forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', () => { autoSavePdfSettings(); updatePdfPreview(); });
  });
}

async function renderPdfScreen() {
  if (!state.currentProjectId) return;
  const settings  = await getSettings(state.currentProjectId);
  const questions = await getQuestionsForProject(state.currentProjectId);

  $('pdf-page-size').value          = settings.pageSize;
  $('pdf-orientation').value        = settings.orientation;
  $('pdf-font-size').value          = settings.fontSize;
  $('pdf-include-images').checked   = settings.includeImages;
  $('pdf-image-size').value         = settings.imageSize;
  $('pdf-line-spacing').value       = settings.lineSpacing;
  $('pdf-show-numbers').checked     = settings.showNumbers;
  $('pdf-show-answers').checked     = settings.showAnswerLines;
  $('pdf-answer-lines').value       = settings.answerLines;
  $('pdf-header').value             = settings.headerText || '';
  $('pdf-footer').value             = settings.footerText || '';
  $('pdf-margin').value             = settings.marginMm;
  $('pdf-question-count').textContent = questions.length;

  updatePdfPreview();
}

function updatePdfPreview() {
  const preview = $('pdf-preview-content');
  const count   = parseInt($('pdf-question-count').textContent) || 0;
  const rows    = Math.min(count, 5);
  const showImg = $('pdf-include-images')?.checked;
  const showAns = $('pdf-show-answers')?.checked;
  const numAns  = parseInt($('pdf-answer-lines')?.value) || 3;

  let html = `<div class="pdf-preview-title">${escHtml($('header-project-name').textContent || 'Project')}</div>`;
  for (let i = 0; i < rows; i++) {
    html += `
      <div class="pdf-preview-row">
        <div class="pdf-preview-num">${i + 1}.</div>
        <div style="flex:1">
          <div style="display:flex;gap:4px;align-items:flex-start">
            <div style="flex:1">
              <div class="pdf-preview-line"></div>
              <div class="pdf-preview-line" style="margin-top:3px;width:70%"></div>
            </div>
            ${showImg ? '<div class="pdf-preview-img-box"></div>' : ''}
          </div>
          ${showAns ? Array.from({length: numAns}).map(() => `<div class="pdf-preview-line" style="margin-top:5px;background:#f0f0f0"></div>`).join('') : ''}
        </div>
      </div>`;
  }
  if (count > 5) html += `<div style="text-align:center;font-size:7px;color:#bbb;padding-top:4px">+ ${count - 5} more</div>`;

  preview.innerHTML = html;
}

async function autoSavePdfSettings() {
  if (!state.currentProjectId) return;
  const settings = await collectPdfSettings();
  await saveSettings(settings);
}

async function collectPdfSettings() {
  const base = await getSettings(state.currentProjectId);
  return {
    ...base,
    projectId:       state.currentProjectId,
    pageSize:        $('pdf-page-size').value,
    orientation:     $('pdf-orientation').value,
    fontSize:        parseInt($('pdf-font-size').value),
    includeImages:   $('pdf-include-images').checked,
    imageSize:       $('pdf-image-size').value,
    lineSpacing:     $('pdf-line-spacing').value,
    showNumbers:     $('pdf-show-numbers').checked,
    showAnswerLines: $('pdf-show-answers').checked,
    answerLines:     parseInt($('pdf-answer-lines').value),
    headerText:      $('pdf-header').value,
    footerText:      $('pdf-footer').value,
    marginMm:        parseInt($('pdf-margin').value),
  };
}

async function handleGeneratePDF() {
  if (!state.currentProjectId) { showToast('Koi active project nahi', 'error'); return; }

  const project   = await getProject(state.currentProjectId);
  const questions = await getQuestionsForProject(state.currentProjectId);

  if (questions.length === 0) {
    showToast('Export karne ke liye koi question nahi', 'info');
    return;
  }

  const settings = await collectPdfSettings();
  await saveSettings(settings);

  showLoading('PDF generate ho rahi hai…');
  try {
    const filename = await generatePDF(project, questions, settings);
    showToast(`PDF save ho gayi: ${filename}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('PDF generate karne mein problem aayi', 'error');
  } finally {
    hideLoading();
  }
}

// ════════════════════════════════════════════════════════════════
// MODALS
// ════════════════════════════════════════════════════════════════

let _modalCallback = null;

function showModal(id, onConfirm) {
  _modalCallback = onConfirm;
  const overlay = document.querySelector(`#${id}`);
  overlay.classList.add('open');
}

function closeModal(id) {
  const overlay = document.querySelector(`#${id}`);
  overlay.classList.remove('open');
  _modalCallback = null;
}

document.addEventListener('click', async e => {
  const confirmBtn = e.target.closest('[data-modal-confirm]');
  const closeBtn   = e.target.closest('[data-modal-close]');
  const overlay    = e.target.closest('.modal-overlay');

  if (confirmBtn) {
    const modalId = confirmBtn.dataset.modalConfirm;
    if (_modalCallback) {
      const ok = await _modalCallback();
      if (ok !== false) closeModal(modalId);
    }
  }

  if (closeBtn) {
    closeModal(closeBtn.dataset.modalClose);
  }

  if (overlay && e.target === overlay) {
    closeModal(overlay.id);
  }
});

function showConfirm(message, onConfirm) {
  $('confirm-message').textContent = message;
  showModal('modal-confirm', async () => {
    await onConfirm();
    return true;
  });
}

// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════

function showToast(message, type = 'info', duration = 3000) {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'i';
  toast.innerHTML = `<span style="font-weight:600;color:${type === 'success' ? 'var(--teal)' : type === 'error' ? 'var(--danger)' : 'var(--amber)'}\">${icon}</span> ${escHtml(message)}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 300ms ease';
    toast.style.opacity    = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ════════════════════════════════════════════════════════════════
// LOADING
// ════════════════════════════════════════════════════════════════

let _loadingEl = null;

function showLoading(message = 'Please wait…') {
  if (_loadingEl) return;
  _loadingEl = document.createElement('div');
  _loadingEl.className = 'loading-overlay';
  _loadingEl.innerHTML = `<div class="spinner"></div><div>${escHtml(message)}</div>`;
  document.body.appendChild(_loadingEl);
}

function hideLoading() {
  if (_loadingEl) { _loadingEl.remove(); _loadingEl = null; }
}

// ════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relDate(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'abhi abhi';
  if (m < 60)  return `${m}m pehle`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h pehle`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d pehle`;
  return new Date(ts).toLocaleDateString('hi-IN');
}
