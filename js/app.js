/**
 * app.js — Main application controller
 *
 * 100% client-side. No backend. No authentication.
 * Data stored in IndexedDB. Images never leave the device.
 */

import {
  openDB,
  saveProject, getProject, getAllProjects, deleteProject,
  saveQuestion, getQuestion, getQuestionsForProject, deleteQuestion, reorderQuestions,
  getSettings, saveSettings,
  blobToURL, dataURLtoBlob,
} from './db.js';

import {
  initCropper, destroyCropper, getCroppedBlob, getThumbBlob,
  readFileAsDataURL, rotateCropper, flipCropper, resetCropper,
} from './crop.js';

import { generatePDF } from './pdf.js';

// ── State ─────────────────────────────────────────────────────
const state = {
  currentProjectId: null,
  editingQuestionId: null,
  activeCropDataURL: null,
  sortable: null,
  objectURLs: [], // tracked for revocation
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

  // Go-home event from header back button
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
        showToast('Open or create a project first', 'info');
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
        <strong>No projects yet</strong>
        <p>Create a new project to start scanning questions.</p>
      </div>`;
    return;
  }

  // Sort newest first
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
          <span>${p.questionCount || 0} q${(p.questionCount || 0) !== 1 ? 's' : ''}</span>
          <span>${relDate(p.updatedAt)}</span>
        </div>
      </div>
      <svg class="project-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  `).join('');

  list.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => openProject(card.dataset.id));
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      confirmDeleteProject(card.dataset.id);
    });
  });
}

function openNewProjectModal() {
  showModal('modal-project', async () => {
    const name = $('input-project-name').value.trim();
    if (!name) { showToast('Enter a project name', 'error'); return false; }

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
  if (!project) { showToast('Project not found', 'error'); return; }
  state.currentProjectId = id;
  $('header-project-name').textContent = project.name;
  $('header-project-name').style.display = 'inline';
  screen('questions');
  renderQuestionsList();
}

async function confirmDeleteProject(id) {
  const project = await getProject(id);
  if (!project) return;
  showConfirm(`Delete "${escHtml(project.name)}"? This will remove all questions and cannot be undone.`, async () => {
    await deleteProject(id);
    if (state.currentProjectId === id) {
      state.currentProjectId = null;
      $('header-project-name').style.display = 'none';
    }
    await renderProjectList();
    showToast('Project deleted', 'info');
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
}

async function renderQuestionsList() {
  if (!state.currentProjectId) return;

  const project   = await getProject(state.currentProjectId);
  const questions = await getQuestionsForProject(state.currentProjectId);
  const list      = $('questions-list');

  $('questions-count').textContent = `${questions.length} question${questions.length !== 1 ? 's' : ''}`;

  // Update project question count
  if (project && project.questionCount !== questions.length) {
    project.questionCount = questions.length;
    await saveProject(project);
  }

  // Revoke old object URLs
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
        <strong>No questions yet</strong>
        <p>Tap the + button to photograph and add your first question.</p>
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
          <div class="question-text">${escHtml(q.text || '(no text)')}</div>
        </div>
        ${thumbSrc ? `<img class="question-thumb" src="${thumbSrc}" alt="Question image">` : ''}
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

  // Sortable
  if (state.sortable) { state.sortable.destroy(); state.sortable = null; }
  if (window.Sortable) {
    state.sortable = Sortable.create(list, {
      handle:    '.drag-handle',
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
    if (!text) { showToast('Question text is required', 'error'); return false; }
    q.text = text;
    await saveQuestion(q);
    await renderQuestionsList();
    // Update project updatedAt
    const project = await getProject(state.currentProjectId);
    if (project) await saveProject(project);
    return true;
  });
  $('input-question-text').value = q.text || '';
  setTimeout(() => $('input-question-text').focus(), 80);
}

async function confirmDeleteQuestion(id) {
  showConfirm('Delete this question? This cannot be undone.', async () => {
    await deleteQuestion(id);
    await renderQuestionsList();
    showToast('Question deleted', 'info');
  });
}

// ════════════════════════════════════════════════════════════════
// CAPTURE SCREEN
// ════════════════════════════════════════════════════════════════

function setupCaptureScreen() {
  const fileInput    = $('file-input');
  const captureZone  = $('capture-zone');
  const cropperWrap  = $('cropper-wrapper');
  const cropImg      = $('crop-image');

  // File input change
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    fileInput.value = '';
  });

  // Drag-and-drop on capture zone
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

  // Save cropped question
  $('btn-save-crop').addEventListener('click', saveCroppedQuestion);

  // Cancel back to questions
  $('btn-cancel-crop').addEventListener('click', () => {
    destroyCropper();
    screen('questions');
  });
}

async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    return;
  }

  showLoading('Loading image…');
  try {
    const dataURL = await readFileAsDataURL(file);
    state.activeCropDataURL = dataURL;

    const cropImg = $('crop-image');
    cropImg.src = dataURL;

    $('capture-zone').style.display  = 'none';
    $('cropper-wrapper').style.display = 'block';
    $('crop-controls').style.display = 'flex';
    $('crop-save-row').style.display = 'flex';

    // Wait for image to load before init Cropper
    cropImg.onload = () => {
      initCropper(cropImg);
      hideLoading();
    };
  } catch (err) {
    hideLoading();
    showToast('Failed to load image', 'error');
    console.error(err);
  }
}

async function saveCroppedQuestion() {
  if (!getCropper()) { showToast('Please select an image first', 'error'); return; }
  if (!state.currentProjectId) { showToast('No active project', 'error'); return; }

  // Open text input modal
  showModal('modal-question-text', async () => {
    const text = $('input-question-text').value.trim();
    if (!text) { showToast('Question text is required', 'error'); return false; }

    showLoading('Saving question…');
    try {
      const croppedBlob = await getCroppedBlob(1600);

      // Thumbnail from cropper canvas
      const canvas = getCropper().getCroppedCanvas({ maxWidth: 160, maxHeight: 160 });
      const thumbBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.7));

      const question = {
        id:           state.editingQuestionId || crypto.randomUUID(),
        projectId:    state.currentProjectId,
        text,
        croppedBlob,
        thumbBlob,
        createdAt:    Date.now(),
        order:        Date.now(),
      };

      await saveQuestion(question);

      // Update project meta
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
      showToast('Question saved', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to save question', 'error');
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
  $('capture-zone').style.display  = 'block';
  $('cropper-wrapper').style.display = 'none';
  $('crop-controls').style.display = 'none';
  $('crop-save-row').style.display = 'none';
  $('crop-image').src = '';
}

// ════════════════════════════════════════════════════════════════
// PDF SCREEN
// ════════════════════════════════════════════════════════════════

function setupPdfScreen() {
  $('btn-generate-pdf').addEventListener('click', handleGeneratePDF);

  // Live-update preview on setting change
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
  // Simple visual preview (not a real PDF render)
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
  if (!state.currentProjectId) { showToast('No active project', 'error'); return; }

  const project   = await getProject(state.currentProjectId);
  const questions = await getQuestionsForProject(state.currentProjectId);

  if (questions.length === 0) {
    showToast('No questions to export', 'info');
    return;
  }

  const settings = await collectPdfSettings();
  await saveSettings(settings);

  showLoading('Generating PDF…');
  try {
    const filename = await generatePDF(project, questions, settings);
    showToast(`PDF saved: ${filename}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('PDF generation failed', 'error');
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

  // Click outside modal to close
  if (overlay && e.target === overlay) {
    closeModal(overlay.id);
  }
});

// ── Confirm dialog ────────────────────────────────────────────
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
  toast.innerHTML = `<span style="font-weight:600;color:${type === 'success' ? 'var(--teal)' : type === 'error' ? 'var(--danger)' : 'var(--amber)'}">${icon}</span> ${escHtml(message)}`;

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
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
