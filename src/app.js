/* =========================================================
   Tauri API
   ========================================================= */
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, stat, exists, readFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

/* =========================================================
   禁用系统右键菜单
   ========================================================= */
window.addEventListener('contextmenu', e => e.preventDefault());

/* =========================================================
   工具函数
   ========================================================= */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatSize(b) {
  if (!b || b <= 0) return '0';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tiff'];
function isImageFile(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTS.includes(name.slice(dot + 1).toLowerCase());
}

function joinPath(dir, name) {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith('/') || dir.endsWith('\\')
    ? dir + name
    : dir + sep + name;
}

function baseName(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function dirName(filePath) {
  const cleaned = filePath.replace(/[\\/][^\\/]+$/, '');
  const name = baseName(cleaned);
  return name || '导入';
}

function splitName(fullName) {
  const dot = fullName.lastIndexOf('.');
  if (dot <= 0) return { base: fullName, ext: '' };
  return { base: fullName.slice(0, dot), ext: fullName.slice(dot) };
}

function normalizePath(p) {
  return String(p).replace(/\\/g, '/');
}

function isInDir(childPath, parentPath) {
  const c = normalizePath(childPath);
  const p = normalizePath(parentPath).replace(/\/+$/, '');
  if (c === p) return true;
  return c.startsWith(p + '/');
}

function getFileExt(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

function isValidFolderName(name) {
  if (!name) return false;
  if (name === '.' || name === '..') return false;
  if (/[\\/:*?"<>|]/.test(name)) return false;
  return true;
}

/* =========================================================
   Toast
   ========================================================= */
let toastEl = null;
let toastTimer = null;

function showToast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/* =========================================================
   默认排序配置
   ========================================================= */
const DEFAULT_SORTS = {
  all:    { by: 'date', desc: true  },
  recent: { by: 'date', desc: true  },
  fav:    { by: 'date', desc: true  },
  folder: { by: 'name', desc: false }
};

/* =========================================================
   渐变模式映射
   ========================================================= */
const GRAD_MODES = {
  vertical:   '180deg',
  horizontal: '90deg',
  diagonal:   '135deg'
};

/* =========================================================
   毛玻璃等级
   ========================================================= */
const ACRYLICS = ['off', 'low', 'mid', 'high'];

/* =========================================================
   字体大小档位（乘数）
   ========================================================= */
const FONT_SCALES = {
  small:  0.9,
  medium: 1,
  large:  1.1
};

/* =========================================================
   数据与状态
   ========================================================= */
let PHOTOS = [];
let nextId = 1;

const state = {
  view: 'all',
  folderName: null,
  query: '',
  favorites: new Set(),
  settings: {
    theme: 'system',
    gradMode: 'horizontal',
    gradColor1: '#3B82F6',
    gradColor2: '#06B6D4',
    fontFamily: 'system',
    fontScale: 'medium',
    customFonts: [],
    cardSize: 180,
    cardRatio: '4:3',
    animations: true,
    showName: true,
    showDate: true,
    acrylic: 'low',
    blur: true,
    compact: false,
    hideDesc: false,
    sorts: JSON.parse(JSON.stringify(DEFAULT_SORTS)),
    knownFolders: [],
    expandedFolders: [],
    folderImportTime: {},
    folderSort: 'name',
    folderPaths: {},
    folderOrder: []
  }
};

/* =========================================================
   字体映射表
   ========================================================= */
const FONTS = {
  system:   '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  yahei:    '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  dengxian: '"DengXian", "等线", "Segoe UI", sans-serif',
  simsun:   '"SimSun", "宋体", "Songti SC", serif',
  simhei:   '"SimHei", "黑体", "Heiti SC", sans-serif',
  kaiti:    '"KaiTi", "楷体", "Kaiti SC", serif',
  cascadia: '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
  consolas: 'Consolas, "Courier New", monospace'
};

/* =========================================================
   缩略图比例映射
   ========================================================= */
const RATIOS = {
  '1:1':  '1 / 1',
  '4:3':  '4 / 3',
  '16:9': '16 / 9'
};

/* =========================================================
   用户导入字体
   ========================================================= */
const loadedFonts = new Map();
const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'];

function isFontFile(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return FONT_EXTS.includes(name.slice(dot + 1).toLowerCase());
}

async function loadFontFile(filePath) {
  if (loadedFonts.has(filePath)) return loadedFonts.get(filePath);

  const bytes = await readFile(filePath);
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();

  const rawName = baseName(filePath).replace(/\.[^.]+$/, '');
  const familyName = `UserFont_${rawName}_${loadedFonts.size}`;

  const mime = ext === 'otf' ? 'font/otf'
             : ext === 'woff' ? 'font/woff'
             : ext === 'woff2' ? 'font/woff2'
             : 'font/ttf';

  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);

  try {
    const face = new FontFace(familyName, `url(${url})`);
    await face.load();
    document.fonts.add(face);
    loadedFonts.set(filePath, { familyName, displayName: rawName, url });
    return loadedFonts.get(filePath);
  } catch (err) {
    URL.revokeObjectURL(url);
    throw new Error('字体加载失败：' + (err.message || err));
  }
}

async function restoreCustomFonts() {
  const list = Array.isArray(state.settings.customFonts) ? state.settings.customFonts : [];
  for (const item of list) {
    if (!item || !item.path) continue;
    try {
      let ok = true;
      try { ok = await exists(item.path); } catch (_) { ok = true; }
      if (!ok) continue;

      const info = await loadFontFile(item.path);
      if (!item.name) item.name = info.displayName;
    } catch (err) {
      console.warn('字体恢复失败：', item.path, err);
    }
  }

  applyFont();
  renderFontSelect();
}

/* =========================================================
   持久化存储（写到 exe 同级的 data/state.json）
   ========================================================= */
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 200);
}

async function saveState() {
  try {
    const data = {
      settings: state.settings,
      favorites: PHOTOS.filter(p => state.favorites.has(p.id)).map(p => p.path),
      photos: PHOTOS.map(p => ({
        name: p.name,
        folder: p.folder,
        path: p.path,
        ts: p.ts,
        size: p.size
      }))
    };
    await invoke('save_state_file', { content: JSON.stringify(data) });
  } catch (err) {
    console.error('保存失败：', err);
  }
}

async function loadState() {
  let raw = null;
  try {
    raw = await invoke('load_state_file');
  } catch (err) {
    console.error('读取状态文件失败：', err);
    return;
  }

  if (!raw) return;

  let data;
  try { data = JSON.parse(raw); } catch (err) {
    console.error('存档解析失败：', err);
    return;
  }

  if (data.settings && typeof data.settings === 'object') {
    Object.assign(state.settings, data.settings);
  }
  if (!Array.isArray(state.settings.customFonts)) {
    state.settings.customFonts = [];
  }
  if (!Array.isArray(state.settings.knownFolders)) {
    state.settings.knownFolders = [];
  }
  if (!Array.isArray(state.settings.expandedFolders)) {
    state.settings.expandedFolders = [];
  }
  if (!Array.isArray(state.settings.folderOrder)) {
    state.settings.folderOrder = [];
  }
  if (!state.settings.folderImportTime || typeof state.settings.folderImportTime !== 'object') {
    state.settings.folderImportTime = {};
  }
  if (!state.settings.folderPaths || typeof state.settings.folderPaths !== 'object') {
    state.settings.folderPaths = {};
  }
  if (!['name', 'time', 'custom'].includes(state.settings.folderSort)) {
    state.settings.folderSort = 'name';
  }
  if (!state.settings.cardRatio) {
    state.settings.cardRatio = '4:3';
  }

  if (!GRAD_MODES[state.settings.gradMode]) {
    state.settings.gradMode = 'horizontal';
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(state.settings.gradColor1 || '')) {
    state.settings.gradColor1 = '#3B82F6';
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(state.settings.gradColor2 || '')) {
    state.settings.gradColor2 = '#06B6D4';
  }

  if (typeof state.settings.acrylic === 'boolean') {
    state.settings.acrylic = state.settings.acrylic ? 'mid' : 'off';
  }
  if (!ACRYLICS.includes(state.settings.acrylic)) {
    state.settings.acrylic = 'low';
  }

  if (!FONT_SCALES[state.settings.fontScale]) {
    state.settings.fontScale = 'medium';
  }

  if (state.settings.blur === undefined) state.settings.blur = true;
  if (state.settings.compact === undefined) state.settings.compact = false;
  if (state.settings.hideDesc === undefined) state.settings.hideDesc = false;

  if (!state.settings.sorts || typeof state.settings.sorts !== 'object') {
    state.settings.sorts = JSON.parse(JSON.stringify(DEFAULT_SORTS));
  } else {
    for (const k of ['all', 'recent', 'fav', 'folder']) {
      const s = state.settings.sorts[k];
      if (!s || typeof s !== 'object' || (s.by !== 'date' && s.by !== 'name') || typeof s.desc !== 'boolean') {
        state.settings.sorts[k] = { ...DEFAULT_SORTS[k] };
      }
    }
  }

  if (Array.isArray(data.photos)) {
    const restored = [];
    for (const p of data.photos) {
      if (!p || !p.path || !p.name) continue;
      if (p.folder === '未分类') continue;

      restored.push({
        id: nextId++,
        name: p.name,
        folder: p.folder || dirName(p.path),
        path: p.path,
        src: convertFileSrc(p.path),
        thumb: null,
        ts: p.ts || Date.now(),
        size: p.size || 0
      });
    }
    PHOTOS = restored;
  }

  if (Array.isArray(data.favorites)) {
    const favPaths = new Set(data.favorites);
    PHOTOS.forEach(p => {
      if (favPaths.has(p.path)) state.favorites.add(p.id);
    });
  }

  if (state.settings.workspace !== undefined) delete state.settings.workspace;
  if (state.settings.ambient !== undefined) delete state.settings.ambient;

  state.settings.knownFolders = state.settings.knownFolders.filter(n => n !== '未分类');
}

/* =========================================================
   后台校验
   ========================================================= */
const VALIDATE_BATCH = 24;
let validating = false;

async function validatePhotosInBackground() {
  if (validating) return;
  validating = true;

  const deadPaths = [];

  for (let i = 0; i < PHOTOS.length; i += VALIDATE_BATCH) {
    const batch = PHOTOS.slice(i, i + VALIDATE_BATCH);

    const results = await Promise.all(batch.map(async p => {
      try {
        return { path: p.path, ok: await exists(p.path) };
      } catch (_) {
        return { path: p.path, ok: true };
      }
    }));

    for (const r of results) {
      if (!r.ok) deadPaths.push(r.path);
    }

    await new Promise(r => setTimeout(r, 0));
  }

  validating = false;

  if (!deadPaths.length) return;

  const deadSet = new Set(deadPaths);

  PHOTOS = PHOTOS.filter(p => !deadSet.has(p.path));

  const aliveIds = new Set(PHOTOS.map(p => p.id));
  [...state.favorites].forEach(id => {
    if (!aliveIds.has(id)) state.favorites.delete(id);
  });

  renderFileList();
  render();
  updateFooter();
  scheduleSave();
}

/* =========================================================
   排序
   ========================================================= */
function getSortKey() {
  return ['all', 'recent', 'fav', 'folder'].includes(state.view)
    ? state.view
    : 'all';
}

function getCurrentSort() {
  const key = getSortKey();
  if (!state.settings.sorts[key]) {
    state.settings.sorts[key] = { ...DEFAULT_SORTS[key] };
  }
  return state.settings.sorts[key];
}

/* =========================================================
   记录目录导入时间
   ========================================================= */
function markFolderImported(folderName) {
  if (!folderName) return;
  if (!state.settings.folderImportTime) {
    state.settings.folderImportTime = {};
  }
  if (!state.settings.folderImportTime[folderName]) {
    state.settings.folderImportTime[folderName] = Date.now();
  }
}

/* =========================================================
   缩略图加载器
   ========================================================= */
const THUMB_SIZE = 400;
const THUMB_CONCURRENCY = 4;

let thumbRunning = 0;
const thumbQueue = [];

function enqueueThumb(photo, imgEl) {
  thumbQueue.push({ photo, imgEl });
  pumpThumbQueue();
}

function pumpThumbQueue() {
  while (thumbRunning < THUMB_CONCURRENCY && thumbQueue.length) {
    const job = thumbQueue.shift();
    thumbRunning++;
    runThumbJob(job).finally(() => {
      thumbRunning--;
      pumpThumbQueue();
    });
  }
}

async function runThumbJob({ photo, imgEl }) {
  if (photo.thumb) {
    imgEl.src = photo.thumb;
    return;
  }
  try {
    const thumbPath = await invoke('get_thumbnail', {
      path: photo.path,
      size: THUMB_SIZE
    });
    photo.thumb = convertFileSrc(thumbPath);
    imgEl.src = photo.thumb;
  } catch (err) {
    console.warn('生成缩略图失败，回退原图：', photo.path, err);
    imgEl.src = photo.src;
  }
}

const THUMB_OBSERVER = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const img = e.target;
    const photo = img._photo;
    THUMB_OBSERVER.unobserve(img);
    if (photo) enqueueThumb(photo, img);
  }
}, {
  root: null,
  rootMargin: '300px 0px',
  threshold: 0
});

/* =========================================================
   DOM 引用
   ========================================================= */
const app           = document.getElementById('app');
const sidebar       = document.getElementById('sidebar');
const grid          = document.getElementById('grid');
const emptyState    = document.getElementById('empty');
const pageTitle     = document.getElementById('pageTitle');
const pageCount     = document.getElementById('pageCount');
const searchInput   = document.getElementById('searchInput');
const fileListEl    = document.getElementById('fileList');
const totalCount    = document.getElementById('totalCount');
const folderCountEl = document.getElementById('folderCount');
const totalSizeEl   = document.getElementById('totalSize');
const toolbarEl     = document.getElementById('toolbar');
const scrollAreaEl  = document.getElementById('scrollArea');
const settingsPanel = document.getElementById('settingsPanel');
const contentEl     = document.querySelector('.content');

const viewer      = document.getElementById('viewer');
const viewerStage = document.getElementById('viewerStage');
const viewerImg   = document.getElementById('viewerImg');
const viewerTitle = document.getElementById('viewerTitle');
const viewerSub   = document.getElementById('viewerSub');
const viewerCount = document.getElementById('viewerCounter');
const viewerFav   = document.getElementById('viewerFav');
const viewerBusy  = document.getElementById('viewerBusy');
const zoomLabel   = document.getElementById('zoomLabel');

const rotateSaveBtn = document.getElementById('viewerRotateSave');

const renameDialog  = document.getElementById('renameDialog');
const renameInput   = document.getElementById('renameInput');
const renameTitleEl = renameDialog.querySelector('.rename-title');

const moveDialog = document.getElementById('moveDialog');
const moveList   = document.getElementById('moveList');

const docsDialog   = document.getElementById('docsDialog');
const docsBtn      = document.getElementById('docsBtn');
const docsCloseBtn = document.getElementById('docsCloseBtn');

const aboutDialog   = document.getElementById('aboutDialog');
const aboutBtn      = document.getElementById('aboutBtn');
const aboutCloseBtn = document.getElementById('aboutCloseBtn');

const folderRemoveDialog  = document.getElementById('folderRemoveDialog');
const folderRemoveNameEl  = document.getElementById('folderRemoveName');
const folderRemoveHintEl  = document.getElementById('folderRemoveHint');

const fontSelect     = document.getElementById('fontSelect');
const fontSizeSeg    = document.getElementById('fontSizeSeg');
const importFontBtn  = document.getElementById('importFontBtn');
const removeFontBtn  = document.getElementById('removeFontBtn');
const compactSeg     = document.getElementById('compactSeg');

const ratioSeg      = document.getElementById('ratioSeg');
const acrylicSeg    = document.getElementById('acrylicSeg');
const blurSwitch    = document.getElementById('blurSwitch');
const gradModeSeg   = document.getElementById('gradModeSeg');
const gradColor1    = document.getElementById('gradColor1');
const gradColor2    = document.getElementById('gradColor2');

const sortDateBtn   = document.getElementById('sortDateBtn');
const sortNameBtn   = document.getElementById('sortNameBtn');

const folderSortBtn    = document.getElementById('folderSortBtn');
const folderRefreshBtn = document.getElementById('folderRefreshBtn');
const folderImportBtn  = document.getElementById('folderImportBtn');
const importMenu       = document.getElementById('importMenu');
const importFilesMenu  = document.getElementById('importFilesMenu');
const importFolderMenu = document.getElementById('importFolderMenu');
const importNewFolderMenu = document.getElementById('importNewFolderMenu');

const FOLDER_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3.5 7.4a2 2 0 0 1 2-2h3.1a1 1 0 0 1 .8.4l1.2 1.6h8a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>
  </svg>`;

const FOLDER_ICON_OPEN = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3.5 7.4a2 2 0 0 1 2-2h3.1a1 1 0 0 1 .8.4l1.2 1.6h8a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>
    <rect x="6" y="13" width="12" height="5" rx="0.8" fill="currentColor" stroke="none"/>
  </svg>`;

/* =========================================================
   窗口控制
   ========================================================= */
document.getElementById('btnMin').addEventListener('click', () => appWindow.minimize());
document.getElementById('btnMax').addEventListener('click', () => appWindow.toggleMaximize());
document.getElementById('btnClose').addEventListener('click', () => appWindow.close());

document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
  if (e.target.closest('.caption-btn')) return;
  appWindow.toggleMaximize();
});

/* =========================================================
   导入菜单
   ========================================================= */
function showImportMenu() {
  importMenu.hidden = false;

  const menuRect = importMenu.getBoundingClientRect();
  const btnRect = folderImportBtn.getBoundingClientRect();
  const w = window.innerWidth;
  const h = window.innerHeight;

  let px = btnRect.left;
  let py = btnRect.bottom + 4;

  if (px + menuRect.width > w - 8) px = w - menuRect.width - 8;
  if (py + menuRect.height > h - 8) py = btnRect.top - menuRect.height - 4;
  if (px < 8) px = 8;
  if (py < 8) py = 8;

  importMenu.style.left = px + 'px';
  importMenu.style.top  = py + 'px';
}

function hideImportMenu() {
  importMenu.hidden = true;
}

folderImportBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (importMenu.hidden) showImportMenu();
  else hideImportMenu();
});

importFilesMenu.addEventListener('click', () => {
  hideImportMenu();
  importFilesViaTauri();
});

importFolderMenu.addEventListener('click', () => {
  hideImportMenu();
  importFolderViaTauri();
});

importNewFolderMenu.addEventListener('click', () => {
  hideImportMenu();
  startCreateFolder();
});

document.addEventListener('mousedown', e => {
  if (importMenu.hidden) return;
  if (e.target.closest('#importMenu')) return;
  if (e.target.closest('#folderImportBtn')) return;
  hideImportMenu();
});

window.addEventListener('resize', () => {
  if (!importMenu.hidden) hideImportMenu();
});

/* =========================================================
   扫描
   ========================================================= */
async function scanFolder(rootDir, overrideRootName = null) {
  const rootName = overrideRootName || baseName(rootDir) || rootDir;
  const items = [];
  const foundFolders = new Set();
  let readError = null;

  async function walk(currentDir, relPath) {
    const folderName = relPath === '' ? rootName : `${rootName}/${relPath}`;
    foundFolders.add(folderName);

    let entries = [];
    try {
      entries = await readDir(currentDir);
    } catch (err) {
      console.warn('读取子目录失败，跳过：', currentDir, err);
      if (relPath === '' && !readError) readError = err;
      return;
    }

    for (const entry of entries) {
      const fullPath = joinPath(currentDir, entry.name);

      if (entry.isDirectory) {
        const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
        await walk(fullPath, childRel);
        continue;
      }

      if (!entry.isFile) continue;
      if (!isImageFile(entry.name)) continue;

      let size = 0, mtime = Date.now();
      try {
        const info = await stat(fullPath);
        size  = info.size || 0;
        mtime = info.mtime ? new Date(info.mtime).getTime() : Date.now();
      } catch (_) {}

      items.push({
        name: entry.name,
        folder: folderName,
        path: fullPath,
        ts: mtime,
        size
      });
    }
  }

  await walk(rootDir, '');
  return { rootName, items, foundFolders, readError };
}

/* =========================================================
   导入：选择文件
   ========================================================= */
async function importFilesViaTauri() {
  let selected;
  try {
    selected = await open({
      multiple: true,
      title: '选择照片',
      filters: [{ name: '图片', extensions: IMAGE_EXTS }]
    });
  } catch (err) {
    console.error('打开文件对话框失败：', err);
    alert('打开文件对话框失败：' + err);
    return;
  }
  if (!selected) return;

  const paths = Array.isArray(selected) ? selected : [selected];
  let added = 0;
  const newFolders = new Set();

  for (const filePath of paths) {
    const name = baseName(filePath);
    if (!isImageFile(name)) continue;

    const folderName = dirName(filePath);

    let size = 0, mtime = Date.now();
    try {
      const info = await stat(filePath);
      size  = info.size || 0;
      mtime = info.mtime ? new Date(info.mtime).getTime() : Date.now();
    } catch (_) {}

    PHOTOS.push({
      id: nextId++,
      name,
      folder: folderName,
      path: filePath,
      src: convertFileSrc(filePath),
      thumb: null,
      ts: mtime,
      size
    });
    newFolders.add(folderName);
    added++;
  }

  if (added > 0) {
    const knownSet = new Set(state.settings.knownFolders || []);
    newFolders.forEach(f => {
      knownSet.add(f);
      markFolderImported(f);
    });
    state.settings.knownFolders = [...knownSet];

    const target = [...newFolders][0];

    state.view = 'folder';
    state.folderName = target;
    state.query = '';
    searchInput.value = '';

    syncActiveNav();
    syncSortUI();
    renderFileList();
    render();
    scheduleSave();
  }
}

/* =========================================================
   导入：选择文件夹
   ========================================================= */
async function importFolderViaTauri() {
  let dir;
  try {
    dir = await open({
      directory: true,
      multiple: false,
      title: '选择照片文件夹'
    });
  } catch (err) {
    console.error('打开文件夹对话框失败：', err);
    alert('打开文件夹对话框失败：' + err);
    return;
  }
  if (!dir) return;
  await loadFolder(dir);
}

async function loadFolder(rootDir) {
  const { rootName, items, foundFolders, readError } = await scanFolder(rootDir);

  if (readError) {
    console.error('读取根目录失败：', readError);
    alert('无法读取该目录：' + readError);
    return;
  }

  if (!items.length && foundFolders.size === 0) {
    alert(`目录「${rootName}」中没有找到图片或子目录。`);
    return;
  }

  if (!state.settings.folderPaths) state.settings.folderPaths = {};
  state.settings.folderPaths[rootName] = rootDir;

  const knownSet = new Set(state.settings.knownFolders || []);
  foundFolders.forEach(f => {
    knownSet.add(f);
    markFolderImported(f);
  });
  state.settings.knownFolders = [...knownSet];

  items.forEach(it => {
    PHOTOS.push({
      id: nextId++,
      name: it.name,
      folder: it.folder,
      path: it.path,
      src: convertFileSrc(it.path),
      thumb: null,
      ts: it.ts,
      size: it.size
    });
  });

  state.view = 'folder';
  state.folderName = rootName;
  state.query = '';
  searchInput.value = '';

  syncActiveNav();
  syncSortUI();
  renderFileList();
  render();
  scheduleSave();
}

/* =========================================================
   刷新
   ========================================================= */
let refreshing = false;

async function refreshAllFolders() {
  if (refreshing) return;

  const folderPaths = state.settings.folderPaths || {};
  const rootNames = Object.keys(folderPaths);

  refreshing = true;
  folderRefreshBtn.classList.add('spinning');

  if (!rootNames.length) {
    setTimeout(() => {
      refreshing = false;
      folderRefreshBtn.classList.remove('spinning');
    }, 700);
    return;
  }

  const oldFavPaths = new Set(
    PHOTOS.filter(p => state.favorites.has(p.id)).map(p => p.path)
  );

  const oldView = state.view;
  const oldFolderName = state.folderName;

  let changed = 0;

  for (const rootName of rootNames) {
    const rootDir = folderPaths[rootName];

    let ok = true;
    try { ok = await exists(rootDir); } catch (_) { ok = true; }
    if (!ok) {
      console.warn('根目录不存在，移除：', rootDir);

      const prefix = rootName + '/';
      PHOTOS = PHOTOS.filter(p => p.folder !== rootName && !p.folder.startsWith(prefix));
      state.settings.knownFolders = (state.settings.knownFolders || [])
        .filter(n => n !== rootName && !n.startsWith(prefix));
      state.settings.expandedFolders = (state.settings.expandedFolders || [])
        .filter(n => n !== rootName && !n.startsWith(prefix));
      state.settings.folderOrder = (state.settings.folderOrder || [])
        .filter(n => n !== rootName);
      delete state.settings.folderPaths[rootName];
      changed++;
      continue;
    }

    const prefix = rootName + '/';
    const beforeLen = PHOTOS.length;
    PHOTOS = PHOTOS.filter(p => p.folder !== rootName && !p.folder.startsWith(prefix));
    const removedCount = beforeLen - PHOTOS.length;

    state.settings.knownFolders = (state.settings.knownFolders || [])
      .filter(n => n !== rootName && !n.startsWith(prefix));
    state.settings.expandedFolders = (state.settings.expandedFolders || [])
      .filter(n => n !== rootName && !n.startsWith(prefix));

    const { items, foundFolders } = await scanFolder(rootDir, rootName);

    const knownSet = new Set(state.settings.knownFolders);
    foundFolders.forEach(f => {
      knownSet.add(f);
      markFolderImported(f);
    });
    state.settings.knownFolders = [...knownSet];

    items.forEach(it => {
      PHOTOS.push({
        id: nextId++,
        name: it.name,
        folder: it.folder,
        path: it.path,
        src: convertFileSrc(it.path),
        thumb: null,
        ts: it.ts,
        size: it.size
      });
    });

    if (removedCount !== items.length) changed++;
  }

  state.favorites.clear();
  PHOTOS.forEach(p => {
    if (oldFavPaths.has(p.path)) state.favorites.add(p.id);
  });

  state.view = oldView;
  state.folderName = oldFolderName;

  if (state.view === 'folder' && state.folderName) {
    const existsNow = PHOTOS.some(p => p.folder === state.folderName)
      || (state.settings.knownFolders || []).includes(state.folderName);
    if (!existsNow) {
      state.view = 'all';
      state.folderName = null;
    }
  }

  refreshing = false;
  folderRefreshBtn.classList.remove('spinning');

  syncActiveNav();
  syncSortUI();
  renderFileList();
  render();
  updateFooter();
  scheduleSave();
}

folderRefreshBtn.addEventListener('click', refreshAllFolders);

/* =========================================================
   目录树构建
   ========================================================= */
function compareFolderName(a, b) {
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function compareFolderTime(a, b, times) {
  const ta = times[a.path] || 0;
  const tb = times[b.path] || 0;
  if (ta !== tb) return tb - ta;
  return compareFolderName(a, b);
}

function buildFolderTree() {
  const counts = new Map();
  PHOTOS.forEach(p => {
    counts.set(p.folder, (counts.get(p.folder) || 0) + 1);
  });

  const nodes = new Map();

  function ensureNode(path) {
    if (!path) return null;
    if (nodes.has(path)) return nodes.get(path);

    const parts = path.split('/');
    const name = parts[parts.length - 1];
    const node = {
      path,
      name,
      count: counts.get(path) || 0,
      children: []
    };
    nodes.set(path, node);

    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = ensureNode(parentPath);
      if (parent) parent.children.push(node);
    }
    return node;
  }

  (state.settings.knownFolders || []).forEach(ensureNode);
  counts.forEach((_, path) => ensureNode(path));

  const roots = [];
  nodes.forEach(node => {
    if (!node.path.includes('/')) roots.push(node);
  });

  const times = state.settings.folderImportTime || {};
  const mode = state.settings.folderSort || 'name';

  let rootComparator;
  if (mode === 'custom') {
    const order = Array.isArray(state.settings.folderOrder) ? state.settings.folderOrder : [];
    const rootPaths = roots.map(r => r.path);
    const filtered = order.filter(p => rootPaths.includes(p));
    for (const p of rootPaths) {
      if (!filtered.includes(p)) filtered.push(p);
    }
    state.settings.folderOrder = filtered;

    const idxOf = (p) => {
      const i = filtered.indexOf(p);
      return i >= 0 ? i : 99999;
    };
    rootComparator = (a, b) => {
      const ia = idxOf(a.path);
      const ib = idxOf(b.path);
      if (ia !== ib) return ia - ib;
      return compareFolderName(a, b);
    };
  } else if (mode === 'time') {
    rootComparator = (a, b) => compareFolderTime(a, b, times);
  } else {
    rootComparator = compareFolderName;
  }

  const childComparator = compareFolderName;

  function sortTree(node) {
    node.children.sort(childComparator);
    node.children.forEach(sortTree);
  }

  roots.forEach(sortTree);
  roots.sort(rootComparator);

  return roots;
}

function renderFolderTree() {
  const roots = buildFolderTree();

  if (!roots.length) {
    fileListEl.innerHTML = `<div class="nav-empty">暂无导入内容</div>`;
    return;
  }

  const expanded = new Set(state.settings.expandedFolders || []);
  const html = roots.map(node => renderNode(node, 0, expanded)).join('');
  fileListEl.innerHTML = html;
}

function renderNode(node, depth, expanded) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const indent = depth * 16;
  const isActive = state.view === 'folder' && state.folderName === node.path;
  const isRoot = depth === 0;

  const icon = hasChildren ? FOLDER_ICON_OPEN : FOLDER_ICON;

  const dragAttrs = isRoot
    ? ' data-root="1"'
    : ' data-root="0"';

  const selfHtml = `
    <div class="nav-item folder-item${isActive ? ' active' : ''}"
         data-view="folder"
         data-folder="${escapeHtml(node.path)}"
         data-has-children="${hasChildren ? '1' : '0'}"${dragAttrs}
         style="padding-left: ${10 + indent}px"
         title="${escapeHtml(node.path)}">
      <span class="folder-ico">${icon}</span>
      <span class="folder-name">${escapeHtml(node.name)}</span>
      <span class="file-tail">
        <button class="file-rename" data-rename-folder="${escapeHtml(node.path)}" title="重命名">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
          </svg>
        </button>
        <button class="file-remove" data-remove-folder="${escapeHtml(node.path)}" title="移除该目录">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </span>
    </div>`;

  let childrenHtml = '';
  if (hasChildren && isExpanded) {
    childrenHtml = node.children.map(c => renderNode(c, depth + 1, expanded)).join('');
  }

  return selfHtml + childrenHtml;
}

function renderFileList() {
  renderFolderTree();
}

/* =========================================================
   目录排序按钮
   ========================================================= */
function syncFolderSortBtn() {
  if (!folderSortBtn) return;
  const mode = state.settings.folderSort || 'name';

  const titles = {
    name:   '按首字母排序',
    time:   '按导入时间排序',
    custom: '自定义排序（可拖动根目录）'
  };
  folderSortBtn.title = titles[mode] || titles.name;

  const icons = folderSortBtn.querySelectorAll('.fs-icon');
  icons.forEach(el => {
    el.hidden = el.dataset.icon !== mode;
  });

  document.body.classList.toggle('folder-custom', mode === 'custom');
}

folderSortBtn.addEventListener('click', () => {
  const mode = state.settings.folderSort || 'name';
  const next = mode === 'name' ? 'time'
             : mode === 'time' ? 'custom'
             : 'name';
  state.settings.folderSort = next;
  syncFolderSortBtn();
  renderFileList();
  scheduleSave();
});

/* =========================================================
   目录拖动排序（只允许最外层）
   ========================================================= */
let dragState = null;

fileListEl.addEventListener('pointerdown', e => {
  if (state.settings.folderSort !== 'custom') return;
  if (e.button !== 0) return;

  if (e.target.closest('.file-remove')) return;
  if (e.target.closest('.file-rename')) return;

  const item = e.target.closest('.folder-item');
  if (!item || item.dataset.root !== '1') return;

  dragState = {
    path: item.dataset.folder,
    el: item,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    pointerId: e.pointerId
  };
});

fileListEl.addEventListener('pointermove', e => {
  if (!dragState) return;
  if (e.pointerId !== dragState.pointerId) return;

  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;

  if (!dragState.active) {
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    dragState.active = true;
    dragState.el.classList.add('dragging');
    document.body.classList.add('folder-dragging');
    try { dragState.el.setPointerCapture(e.pointerId); } catch (_) {}
  }

  e.preventDefault();

  const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
  const target = elemBelow ? elemBelow.closest('.folder-item[data-root="1"]') : null;

  fileListEl.querySelectorAll('.drop-before, .drop-after').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });

  if (target && target !== dragState.el) {
    const rect = target.getBoundingClientRect();
    const isAfter = e.clientY > rect.top + rect.height / 2;
    target.classList.add(isAfter ? 'drop-after' : 'drop-before');
  }
});

function endFolderDrag(e) {
  if (!dragState) return;
  if (e.pointerId !== dragState.pointerId) return;

  const wasActive = dragState.active;
  const draggedPath = dragState.path;

  dragState.el.classList.remove('dragging');
  document.body.classList.remove('folder-dragging');
  try { dragState.el.releasePointerCapture(e.pointerId); } catch (_) {}

  let targetPath = null;
  let isAfter = false;

  const dropAfter = fileListEl.querySelector('.drop-after');
  const dropBefore = fileListEl.querySelector('.drop-before');
  const dropTarget = dropAfter || dropBefore;

  if (dropTarget) {
    targetPath = dropTarget.dataset.folder;
    isAfter = !!dropAfter;
  }

  fileListEl.querySelectorAll('.drop-before, .drop-after').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });

  dragState = null;

  if (!wasActive) return;
  if (!targetPath || targetPath === draggedPath) return;

  const order = Array.isArray(state.settings.folderOrder)
    ? [...state.settings.folderOrder]
    : [];

  if (!order.includes(draggedPath)) order.push(draggedPath);
  if (!order.includes(targetPath)) order.push(targetPath);

  const srcIdx = order.indexOf(draggedPath);
  if (srcIdx >= 0) order.splice(srcIdx, 1);

  let insertIdx = order.indexOf(targetPath);
  if (insertIdx < 0) insertIdx = order.length;
  if (isAfter) insertIdx += 1;

  order.splice(insertIdx, 0, draggedPath);

  state.settings.folderOrder = order;
  scheduleSave();
  renderFileList();
}

fileListEl.addEventListener('pointerup', endFolderDrag);
fileListEl.addEventListener('pointercancel', endFolderDrag);

/* =========================================================
   图片拖动到目录
   ========================================================= */
let cardDragState = null;
let suppressCardClick = false;

grid.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (e.target.closest('.fav-toggle')) return;

  const card = e.target.closest('.card');
  if (!card) return;

  const id = Number(card.dataset.id);
  const photo = PHOTOS.find(p => p.id === id);
  if (!photo) return;

  cardDragState = {
    photo,
    el: card,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    pointerId: e.pointerId,
    ghost: null,
    lastTarget: null
  };
});

grid.addEventListener('pointermove', e => {
  if (!cardDragState) return;
  if (e.pointerId !== cardDragState.pointerId) return;

  const dx = e.clientX - cardDragState.startX;
  const dy = e.clientY - cardDragState.startY;

  if (!cardDragState.active) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    cardDragState.active = true;

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const img = document.createElement('img');
    img.src = cardDragState.photo.thumb || cardDragState.photo.src;
    img.alt = '';
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    cardDragState.ghost = ghost;

    document.body.classList.add('card-dragging');
    try { cardDragState.el.setPointerCapture(e.pointerId); } catch (_) {}
  }

  e.preventDefault();

  if (cardDragState.ghost) {
    cardDragState.ghost.style.left = e.clientX + 'px';
    cardDragState.ghost.style.top = e.clientY + 'px';
  }

  const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
  const folderItem = elemBelow ? elemBelow.closest('.folder-item') : null;

  if (folderItem !== cardDragState.lastTarget) {
    document.querySelectorAll('.folder-item.drop-target').forEach(el => {
      el.classList.remove('drop-target');
    });
    if (folderItem) folderItem.classList.add('drop-target');
    cardDragState.lastTarget = folderItem;
  }
});

async function endCardDrag(e) {
  if (!cardDragState) return;
  if (e.pointerId !== cardDragState.pointerId) return;

  const dragInfo = cardDragState;
  cardDragState = null;

  if (dragInfo.ghost && dragInfo.ghost.parentNode) {
    dragInfo.ghost.parentNode.removeChild(dragInfo.ghost);
  }

  document.body.classList.remove('card-dragging');
  try { dragInfo.el.releasePointerCapture(e.pointerId); } catch (_) {}

  document.querySelectorAll('.folder-item.drop-target').forEach(el => {
    el.classList.remove('drop-target');
  });

  if (!dragInfo.active) return;

  suppressCardClick = true;
  setTimeout(() => { suppressCardClick = false; }, 150);

  const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
  const folderItem = elemBelow ? elemBelow.closest('.folder-item') : null;
  if (!folderItem) return;

  const targetFolder = folderItem.dataset.folder;
  if (!targetFolder) return;

  await movePhotoToFolder(dragInfo.photo, targetFolder);
}

grid.addEventListener('pointerup', endCardDrag);
grid.addEventListener('pointercancel', endCardDrag);

async function movePhotoToFolder(photo, virtualFolderPath) {
  if (photo.folder === virtualFolderPath) return;

  const dstDir = folderVirtualToReal(virtualFolderPath);
  if (!dstDir) {
    showToast('目标目录不可用');
    return;
  }

  const currentDir = photo.path.replace(/[\\/][^\\/]+$/, '');
  if (normalizePath(currentDir) === normalizePath(dstDir)) {
    return;
  }

  try {
    const oldPath = photo.path;
    const newPath = await invoke('move_file', { src: oldPath, dstDir });

    invoke('rename_thumbnail_cache', {
      oldPaths: [oldPath],
      newPaths: [newPath],
      size: THUMB_SIZE
    }).catch(() => {});

    photo.path = newPath;
    photo.src = convertFileSrc(newPath) + '?t=' + Date.now();
    photo.thumb = null;
    photo.folder = virtualFolderPath;

    try {
      const info = await stat(newPath);
      photo.size = info.size || photo.size;
      photo.ts = info.mtime ? new Date(info.mtime).getTime() : photo.ts;
    } catch (_) {}

    renderFileList();
    render();
    updateFooter();
    scheduleSave();

    showToast('已移动到「' + virtualFolderPath + '」');
  } catch (err) {
    alert('移动失败：' + err);
  }
}

/* =========================================================
   过滤、排序与标题
   ========================================================= */
function getVisible() {
  let list = PHOTOS.slice();

  if (state.view === 'fav') {
    list = list.filter(p => state.favorites.has(p.id));
  } else if (state.view === 'folder' && state.folderName) {
    list = list.filter(p => p.folder === state.folderName);
  }

  const q = state.query.trim().toLowerCase();
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q));

  const sort = getCurrentSort();

  list.sort((a, b) => {
    let cmp;
    if (sort.by === 'name') {
      cmp = a.name.localeCompare(b.name, 'zh-CN', {
        numeric: true,
        sensitivity: 'base'
      });
    } else {
      cmp = a.ts - b.ts;
    }
    return sort.desc ? -cmp : cmp;
  });

  return list;
}

function currentTitle() {
  switch (state.view) {
    case 'fav':    return '收藏';
    case 'folder': return state.folderName || '目录';
    default:       return '所有照片';
  }
}

/* =========================================================
   渲染
   ========================================================= */
function cardHTML(p) {
  const fav = state.favorites.has(p.id);
  const showName = state.settings.showName;
  const showDate = state.settings.showDate;
  const hasMeta = showName || showDate;

  return `
    <article class="card" data-id="${p.id}" tabindex="0">
      <img alt="${escapeHtml(p.name)}" decoding="async" draggable="false">
      ${hasMeta ? `
        <div class="card-shade"></div>
        <div class="card-meta">
          ${showName ? `<span class="card-title">${escapeHtml(p.name)}</span>` : ''}
          ${showDate ? `<span class="card-date">${fmtDate(p.ts)}</span>` : ''}
        </div>` : ''}
      <button class="fav-toggle ${fav ? 'on' : ''}" data-fav="${p.id}" title="收藏">
        <svg viewBox="0 0 24 24">
          <path d="M12 20.3 4.9 13.2a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.6.6.6-.6a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5z"/>
        </svg>
      </button>
    </article>`;
}

function applyCardAnimations() {
  void grid.offsetHeight;
}

function renderCards(list) {
  grid.innerHTML = '';
  if (!list.length) return;

  const html = list.map(cardHTML).join('');
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  grid.appendChild(tpl.content);

  const imgs = grid.querySelectorAll('img');
  imgs.forEach((img, i) => {
    img._photo = list[i];
    THUMB_OBSERVER.observe(img);
  });

  applyCardAnimations();
}

function render() {
  const isSettings = state.view === 'settings';
  settingsPanel.hidden = !isSettings;
  toolbarEl.style.display = isSettings ? 'none' : '';
  scrollAreaEl.style.display = isSettings ? 'none' : '';
  contentEl.classList.toggle('settings-view', isSettings);

  if (isSettings) {
    updateFooter();
    return;
  }

  const list = getVisible();

  pageTitle.textContent = `${currentTitle()}（${list.length}）`;
  pageCount.textContent = '';

  renderCards(list);

  if (!list.length) {
    emptyState.hidden = false;
    scrollAreaEl.classList.add('is-empty');

    if (!PHOTOS.length) {
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="4" width="18" height="16" rx="3"/>
          <circle cx="8.5" cy="9.5" r="1.7"/>
          <path d="M21 15.5 16 10.5 7 20"/>
        </svg>
        <p>还没有导入任何照片</p>
        <small>点击左上角「目录」右侧的 + 按钮，导入照片或文件夹</small>`;
    } else if (state.view === 'fav') {
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M12 20.3 4.9 13.2a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.6.6.6-.6a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5z"/>
        </svg>
        <p>还没有收藏任何照片</p>
        <small>在图片上悬停，点击右上角的爱心即可收藏</small>`;
    } else if (state.view === 'folder') {
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M3.5 7.4a2 2 0 0 1 2-2h3.1a1 1 0 0 1 .8.4l1.2 1.6h8a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>
        </svg>
        <p>该目录中没有匹配的照片</p>
        <small>试试换个关键词，或选择其他目录</small>`;
    } else {
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="11" cy="11" r="7"/>
          <path d="M20 20l-3.6-3.6"/>
        </svg>
        <p>没有找到匹配的照片</p>
        <small>试试换个关键词，或选择其他分类</small>`;
    }
  } else {
    emptyState.hidden = true;
    emptyState.innerHTML = '';
    scrollAreaEl.classList.remove('is-empty');
  }

  updateFooter();
}

function countFolders() {
  return (state.settings.knownFolders || []).length;
}

function updateFooter() {
  const totalBytes = PHOTOS.reduce((sum, p) => sum + (p.size || 0), 0);

  totalCount.textContent = PHOTOS.length;
  folderCountEl.textContent = countFolders();
  totalSizeEl.textContent = formatSize(totalBytes);
}

/* =========================================================
   侧边栏交互
   ========================================================= */
function syncActiveNav() {
  document.querySelectorAll('.nav-item').forEach(n => {
    const v = n.dataset.view;
    let active;
    if (v === 'folder') {
      active = state.view === 'folder' && n.dataset.folder === state.folderName;
    } else {
      active = state.view === v;
    }
    n.classList.toggle('active', active);
  });
}

sidebar.addEventListener('click', e => {
  const rmF = e.target.closest('.file-remove');
  if (rmF) {
    e.stopPropagation();
    openFolderRemoveDialog(rmF.dataset.removeFolder);
    return;
  }

  const rnF = e.target.closest('.file-rename');
  if (rnF) {
    e.stopPropagation();
    openFolderRenameDialog(rnF.dataset.renameFolder);
    return;
  }

  const item = e.target.closest('.nav-item');
  if (!item) return;

  const v = item.dataset.view;
  const folderPath = item.dataset.folder;
  const hasChildren = item.dataset.hasChildren === '1';

  state.query = '';
  searchInput.value = '';

  state.view = v;
  state.folderName = v === 'folder' ? folderPath : null;

  if (v === 'folder' && hasChildren) {
    const expanded = new Set(state.settings.expandedFolders || []);
    if (expanded.has(folderPath)) {
      expanded.delete(folderPath);
    } else {
      expanded.add(folderPath);
    }
    state.settings.expandedFolders = [...expanded];
    renderFileList();
  }

  syncActiveNav();
  syncSortUI();
  render();
  scheduleSave();
});

function removeFolder(name) {
  const prefix = name + '/';

  PHOTOS = PHOTOS.filter(p => {
    const inSelf = p.folder === name;
    const inChild = p.folder.startsWith(prefix);
    if (inSelf || inChild) {
      state.favorites.delete(p.id);
      return false;
    }
    return true;
  });

  state.settings.knownFolders = (state.settings.knownFolders || [])
    .filter(n => n !== name && !n.startsWith(prefix));

  state.settings.expandedFolders = (state.settings.expandedFolders || [])
    .filter(n => n !== name && !n.startsWith(prefix));

  state.settings.folderOrder = (state.settings.folderOrder || [])
    .filter(n => n !== name);

  if (state.settings.folderImportTime) {
    for (const key of Object.keys(state.settings.folderImportTime)) {
      if (key === name || key.startsWith(prefix)) {
        delete state.settings.folderImportTime[key];
      }
    }
  }

  if (state.settings.folderPaths && state.settings.folderPaths[name]) {
    delete state.settings.folderPaths[name];
  }

  if (state.view === 'folder' && (
      state.folderName === name ||
      (state.folderName && state.folderName.startsWith(prefix))
  )) {
    state.view = 'all';
    state.folderName = null;
  }
  if (!viewer.hidden) closeViewer();

  syncActiveNav();
  syncSortUI();
  renderFileList();
  render();
  scheduleSave();
}

/* =========================================================
   移除文件夹对话框（仅图库 / 删除到回收站）
   ========================================================= */
let folderRemoveTarget = null;

function openFolderRemoveDialog(virtualPath) {
  if (!virtualPath) return;
  folderRemoveTarget = virtualPath;

  const isRoot = !virtualPath.includes('/');
  const isImportedRoot = isRoot && state.settings.folderPaths && state.settings.folderPaths[virtualPath];

  folderRemoveNameEl.textContent = `「${baseName(virtualPath)}」`;

  const trashBtn = folderRemoveDialog.querySelector('[data-action="trash"]');

  if (isImportedRoot) {
    trashBtn.hidden = true;
    folderRemoveHintEl.textContent = '这是导入的根文件夹，移除只会从图库中隐藏，本地文件保持不变。';
  } else {
    trashBtn.hidden = false;
    folderRemoveHintEl.textContent = '请选择移除方式：';
  }

  folderRemoveDialog.hidden = false;
  folderRemoveDialog.classList.toggle('dark', app.classList.contains('dark'));
  requestAnimationFrame(() => folderRemoveDialog.classList.add('show'));
}

function hideFolderRemoveDialog() {
  if (folderRemoveDialog.hidden) return;
  folderRemoveDialog.classList.remove('show');
  setTimeout(() => { folderRemoveDialog.hidden = true; }, 180);
  folderRemoveTarget = null;
}

folderRemoveDialog.querySelector('.folder-remove-backdrop')
  .addEventListener('click', hideFolderRemoveDialog);
document.getElementById('folderRemoveCancel')
  .addEventListener('click', hideFolderRemoveDialog);

folderRemoveDialog.querySelectorAll('.folder-remove-option').forEach(btn => {
  btn.addEventListener('click', async () => {
    const target = folderRemoveTarget;
    if (!target) { hideFolderRemoveDialog(); return; }

    const action = btn.dataset.action;

    /* ---- 仅从图库移除 ---- */
    if (action === 'gallery') {
      hideFolderRemoveDialog();
      removeFolder(target);
      return;
    }

    /* ---- 删除到回收站 ---- */
    if (action === 'trash') {
      const realPath = folderVirtualToReal(target);
      if (!realPath) {
        alert('无法解析该文件夹的本地路径');
        hideFolderRemoveDialog();
        return;
      }

      try {
        const ok = await exists(realPath);
        if (!ok) {
          showToast('本地文件夹已不存在');
          hideFolderRemoveDialog();
          removeFolder(target);
          return;
        }
      } catch (_) {}

      try {
        await invoke('delete_to_trash', { paths: [realPath] });
        hideFolderRemoveDialog();
        removeFolder(target);
        showToast('已删除到回收站');
      } catch (err) {
        console.error('删除失败：', err);
        alert('删除失败：' + err);
      }
    }
  });
});

/* =========================================================
   文件夹重命名 / 新建子目录
   ========================================================= */
let renameDialogMode = 'file';
let renameTargetPath = null;

function openFolderRenameDialog(virtualPath) {
  renameDialogMode = 'folder';
  renameTargetPath = virtualPath;

  renameInput.value = baseName(virtualPath);
  renameTitleEl.textContent = '重命名文件夹';
  renameInput.placeholder = '输入新的文件夹名';

  renameDialog.hidden = false;
  requestAnimationFrame(() => {
    renameDialog.classList.add('show');
    renameInput.focus();
    renameInput.select();
  });
}

function openCreateFolderDialog(parentVirtualPath) {
  renameDialogMode = 'newFolder';
  renameTargetPath = parentVirtualPath;

  renameInput.value = '';
  renameTitleEl.textContent = '新建文件夹';
  renameInput.placeholder = '输入文件夹名';

  renameDialog.hidden = false;
  requestAnimationFrame(() => {
    renameDialog.classList.add('show');
    renameInput.focus();
  });
}

/* =========================================================
   新建文件夹：根据是否选中文件夹判断创建位置
   ========================================================= */
async function startCreateFolder() {
  /* 情况 A：已经选中了某个文件夹 → 在该文件夹下创建子目录 */
  if (state.view === 'folder' && state.folderName) {
    openCreateFolderDialog(state.folderName);
    return;
  }

  /* 情况 B：未选中文件夹 → 让用户选择位置，创建一级目录 */
  let parentDir;
  try {
    parentDir = await open({
      directory: true,
      multiple: false,
      title: '选择新文件夹的创建位置'
    });
  } catch (err) {
    alert('打开对话框失败：' + err);
    return;
  }
  if (!parentDir) return;

  /* 先看它是不是在某个已导入的根目录下 */
  let parentVirtual = resolveVirtualForRealDir(parentDir);

  /* 不在任何已导入目录下 → 把它注册为新的根目录 */
  if (!parentVirtual) {
    const folderPaths = state.settings.folderPaths || (state.settings.folderPaths = {});

    let rootName = baseName(parentDir) || parentDir;
    let finalName = rootName;
    let suffix = 1;
    while (
      folderPaths[finalName] &&
      normalizePath(folderPaths[finalName]) !== normalizePath(parentDir)
    ) {
      finalName = `${rootName} (${suffix++})`;
    }
    rootName = finalName;

    folderPaths[rootName] = parentDir;

    const knownSet = new Set(state.settings.knownFolders || []);
    knownSet.add(rootName);
    state.settings.knownFolders = [...knownSet];
    markFolderImported(rootName);

    parentVirtual = rootName;
    renderFileList();
  }

  openCreateFolderDialog(parentVirtual);
}

/* 由物理目录反查虚拟路径 */
function resolveVirtualForRealDir(realDir) {
  const folderPaths = state.settings.folderPaths || {};
  for (const [rootName, rootDir] of Object.entries(folderPaths)) {
    if (isInDir(realDir, rootDir)) {
      const rel = normalizePath(realDir)
        .slice(normalizePath(rootDir).replace(/\/+$/, '').length)
        .replace(/^\/+/, '');
      return rel ? `${rootName}/${rel}` : rootName;
    }
  }
  return null;
}

async function confirmFolderRename(newName) {
  const oldVirtual = renameTargetPath;
  if (!oldVirtual) { hideRenameDialog(); return; }

  const oldName = baseName(oldVirtual);
  if (newName === oldName) { hideRenameDialog(); return; }

  const oldReal = folderVirtualToReal(oldVirtual);
  if (!oldReal) {
    alert('目录路径无效');
    hideRenameDialog();
    return;
  }

  try {
    const newReal = await invoke('rename_folder', {
      oldPath: oldReal,
      newName
    });

    const parentVirtual = oldVirtual.includes('/')
      ? oldVirtual.slice(0, oldVirtual.lastIndexOf('/'))
      : '';
    const newVirtual = parentVirtual ? `${parentVirtual}/${newName}` : newName;

    applyFolderRename(oldVirtual, newVirtual, oldReal, newReal, oldName, newName);

    syncActiveNav();
    renderFileList();
    render();
    updateFooter();
    scheduleSave();
    hideRenameDialog();
    showToast('已重命名为「' + newName + '」');
  } catch (err) {
    alert('重命名失败：' + err);
  }
}

async function confirmCreateFolder(name) {
  const parentVirtual = renameTargetPath;
  if (!parentVirtual) { hideRenameDialog(); return; }

  const parentReal = folderVirtualToReal(parentVirtual);
  if (!parentReal) {
    alert('父目录路径无效');
    hideRenameDialog();
    return;
  }

  try {
    await invoke('create_folder', {
      parentDir: parentReal,
      name
    });

    const newVirtual = `${parentVirtual}/${name}`;

    const knownSet = new Set(state.settings.knownFolders || []);
    knownSet.add(newVirtual);
    state.settings.knownFolders = [...knownSet];

    markFolderImported(newVirtual);

    const expanded = new Set(state.settings.expandedFolders || []);
    expanded.add(parentVirtual);
    state.settings.expandedFolders = [...expanded];

    renderFileList();
    scheduleSave();
    hideRenameDialog();
    showToast('已创建「' + name + '」');
  } catch (err) {
    alert('创建失败：' + err);
  }
}

function applyFolderRename(oldVirtual, newVirtual, oldReal, newReal, oldName, newName) {
  /* 1. PHOTOS[].folder：虚拟路径前缀替换 */
  PHOTOS.forEach(p => {
    if (p.folder === oldVirtual) {
      p.folder = newVirtual;
    } else if (p.folder.startsWith(oldVirtual + '/')) {
      p.folder = newVirtual + p.folder.slice(oldVirtual.length);
    }
  });

  /* 2. PHOTOS[].path：物理路径前缀替换 */
  const oldRealNorm = normalizePath(oldReal);
  const newRealNorm = normalizePath(newReal);
  const stamp = Date.now();

  const cacheOldPaths = [];
  const cacheNewPaths = [];

  PHOTOS.forEach(p => {
    const np = normalizePath(p.path);
    if (np === oldRealNorm) {
      cacheOldPaths.push(p.path);
      cacheNewPaths.push(newReal);
      p.path = newReal;
      p.src = convertFileSrc(newReal) + '?t=' + stamp;
      p.thumb = null;
    } else if (np.startsWith(oldRealNorm + '/')) {
      const newPath = newRealNorm + np.slice(oldRealNorm.length);
      cacheOldPaths.push(p.path);
      cacheNewPaths.push(newPath);
      p.path = newPath;
      p.src = convertFileSrc(newPath) + '?t=' + stamp;
      p.thumb = null;
    }
  });

  if (cacheOldPaths.length > 0) {
    invoke('rename_thumbnail_cache', {
      oldPaths: cacheOldPaths,
      newPaths: cacheNewPaths,
      size: THUMB_SIZE
    }).catch(() => {});
  }

  /* 3. knownFolders 前缀替换 */
  state.settings.knownFolders = (state.settings.knownFolders || []).map(n => {
    if (n === oldVirtual) return newVirtual;
    if (n.startsWith(oldVirtual + '/')) return newVirtual + n.slice(oldVirtual.length);
    return n;
  });

  /* 4. expandedFolders 前缀替换 */
  state.settings.expandedFolders = (state.settings.expandedFolders || []).map(n => {
    if (n === oldVirtual) return newVirtual;
    if (n.startsWith(oldVirtual + '/')) return newVirtual + n.slice(oldVirtual.length);
    return n;
  });

  /* 5. folderImportTime 键名前缀替换 */
  const newTimes = {};
  for (const [key, val] of Object.entries(state.settings.folderImportTime || {})) {
    if (key === oldVirtual) {
      newTimes[newVirtual] = val;
    } else if (key.startsWith(oldVirtual + '/')) {
      newTimes[newVirtual + key.slice(oldVirtual.length)] = val;
    } else {
      newTimes[key] = val;
    }
  }
  state.settings.folderImportTime = newTimes;

  /* 6. 根目录：folderPaths 键名 + folderOrder */
  if (!oldVirtual.includes('/')) {
    if (state.settings.folderPaths[oldName]) {
      delete state.settings.folderPaths[oldName];
    }
    state.settings.folderPaths[newName] = newReal;

    state.settings.folderOrder = (state.settings.folderOrder || []).map(n =>
      n === oldName ? newName : n
    );
  }

  /* 7. 如果正在浏览的目录被改名，同步 state.folderName */
  if (state.view === 'folder' && state.folderName) {
    if (state.folderName === oldVirtual) {
      state.folderName = newVirtual;
    } else if (state.folderName.startsWith(oldVirtual + '/')) {
      state.folderName = newVirtual + state.folderName.slice(oldVirtual.length);
    }
  }
}

/* =========================================================
   搜索
   ========================================================= */
let searchTimer = null;
searchInput.addEventListener('input', e => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => {
    state.query = v;
    if (state.view === 'settings') {
      state.view = 'all';
      state.folderName = null;
      syncActiveNav();
    }
    render();
  }, 130);
});

/* =========================================================
   工具栏排序
   ========================================================= */
sortDateBtn.addEventListener('click', () => {
  const sort = getCurrentSort();
  if (sort.by === 'date') {
    sort.desc = !sort.desc;
  } else {
    sort.by = 'date';
    sort.desc = true;
  }
  syncSortUI();
  render();
  scheduleSave();
});

sortNameBtn.addEventListener('click', () => {
  const sort = getCurrentSort();
  if (sort.by === 'name') {
    sort.desc = !sort.desc;
  } else {
    sort.by = 'name';
    sort.desc = false;
  }
  syncSortUI();
  render();
  scheduleSave();
});

function syncSortUI() {
  const sort = getCurrentSort();

  const isDate = sort.by === 'date';
  const isName = sort.by === 'name';

  sortDateBtn.classList.toggle('on', isDate);
  sortNameBtn.classList.toggle('on', isName);

  sortDateBtn.title = isDate
    ? (sort.desc ? '按时间排序 · 最新优先' : '按时间排序 · 最早优先')
    : '按时间排序';
  sortNameBtn.title = isName
    ? (sort.desc ? '按名称排序 · Z-A' : '按名称排序 · A-Z')
    : '按名称排序';
}

/* =========================================================
   设置面板
   ========================================================= */
const themeSeg   = document.getElementById('themeSeg');
const sizeRange  = document.getElementById('sizeRange');
const sizeVal    = document.getElementById('sizeVal');
const animSwitch = document.getElementById('animSwitch');
const nameSwitch = document.getElementById('nameSwitch');
const dateSwitch = document.getElementById('dateSwitch');

const mq = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'system' && mq.matches);
  app.classList.toggle('dark', dark);
  document.body.classList.toggle('dark', dark);
  renameDialog.classList.toggle('dark', dark);
  moveDialog.classList.toggle('dark', dark);
  docsDialog.classList.toggle('dark', dark);
  aboutDialog.classList.toggle('dark', dark);
  folderRemoveDialog.classList.toggle('dark', dark);
}

mq.addEventListener('change', () => {
  if (state.settings.theme === 'system') applyTheme();
});

themeSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.settings.theme = b.dataset.theme;
  [...themeSeg.children].forEach(x => x.classList.toggle('on', x === b));
  applyTheme();
  scheduleSave();
});

gradModeSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.settings.gradMode = b.dataset.mode;
  [...gradModeSeg.children].forEach(x => x.classList.toggle('on', x === b));
  applyGradient();
  scheduleSave();
});

gradColor1.addEventListener('input', () => {
  state.settings.gradColor1 = gradColor1.value;
  applyGradient();
  scheduleSave();
});
gradColor2.addEventListener('input', () => {
  state.settings.gradColor2 = gradColor2.value;
  applyGradient();
  scheduleSave();
});

acrylicSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.settings.acrylic = b.dataset.acrylic;
  [...acrylicSeg.children].forEach(x => x.classList.toggle('on', x === b));
  applyEffects();
  scheduleSave();
});

blurSwitch.addEventListener('change', () => {
  state.settings.blur = blurSwitch.checked;
  applyEffects();
  scheduleSave();
});

function compactModeOf() {
  if (state.settings.compact) return 'on';
  if (state.settings.hideDesc) return 'partial';
  return 'off';
}

function syncCompactSeg() {
  const mode = compactModeOf();
  [...compactSeg.children].forEach(b => {
    b.classList.toggle('on', b.dataset.compact === mode);
  });
}

function setCompactMode(mode) {
  if (mode === 'partial') {
    state.settings.compact = false;
    state.settings.hideDesc = true;
  } else if (mode === 'on') {
    state.settings.compact = true;
    state.settings.hideDesc = false;
  } else {
    state.settings.compact = false;
    state.settings.hideDesc = false;
  }
  syncCompactSeg();
  applyCompact();
  scheduleSave();
}

compactSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  setCompactMode(b.dataset.compact);
});

fontSelect.addEventListener('change', () => {
  state.settings.fontFamily = fontSelect.value;
  applyFont();
  removeFontBtn.hidden = !fontSelect.value.startsWith('user:');
  scheduleSave();
});

fontSizeSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const mode = b.dataset.fs;
  if (!FONT_SCALES[mode]) return;
  state.settings.fontScale = mode;
  [...fontSizeSeg.children].forEach(x => x.classList.toggle('on', x === b));
  applyFontScale();
  scheduleSave();
});

importFontBtn.addEventListener('click', async () => {
  let selected;
  try {
    selected = await open({
      multiple: true,
      title: '选择字体文件',
      filters: [{ name: '字体', extensions: FONT_EXTS }]
    });
  } catch (err) {
    console.error('打开对话框失败：', err);
    alert('打开对话框失败：' + err);
    return;
  }
  if (!selected) return;

  const paths = Array.isArray(selected) ? selected : [selected];
  let added = 0;
  let firstKey = null;

  for (const path of paths) {
    const name = baseName(path);
    if (!isFontFile(name)) continue;
    if (state.settings.customFonts.some(f => f.path === path)) continue;

    try {
      const info = await loadFontFile(path);
      state.settings.customFonts.push({
        name: info.displayName,
        path
      });
      if (!firstKey) firstKey = 'user:' + path;
      added++;
    } catch (err) {
      console.error('字体加载失败：', path, err);
      alert('字体加载失败：' + name + '\n' + (err.message || err));
    }
  }

  if (added > 0) {
    state.settings.fontFamily = firstKey || 'system';
    applyFont();
    renderFontSelect();
    scheduleSave();
  }
});

removeFontBtn.addEventListener('click', () => {
  const key = state.settings.fontFamily || '';
  if (!key.startsWith('user:')) return;
  const path = key.slice(5);

  const idx = state.settings.customFonts.findIndex(f => f.path === path);
  if (idx < 0) return;

  const info = state.settings.customFonts[idx];
  if (!confirm(`确定要移除字体「${info.name}」吗？`)) return;

  state.settings.customFonts.splice(idx, 1);

  const cached = loadedFonts.get(path);
  if (cached && cached.url) URL.revokeObjectURL(cached.url);
  loadedFonts.delete(path);

  state.settings.fontFamily = 'system';
  applyFont();
  renderFontSelect();
  scheduleSave();
});

function applyCardSize() {
  document.documentElement.style.setProperty('--card-size', state.settings.cardSize + 'px');
}

function applyCardRatio() {
  const key = state.settings.cardRatio || '4:3';
  const val = RATIOS[key] || RATIOS['4:3'];
  document.documentElement.style.setProperty('--card-ratio', val);
}

function applyGradient() {
  const mode = state.settings.gradMode || 'horizontal';
  const angle = GRAD_MODES[mode] || GRAD_MODES.horizontal;
  const c1 = state.settings.gradColor1 || '#3B82F6';
  const c2 = state.settings.gradColor2 || '#06B6D4';

  app.style.setProperty('--grad-angle', angle);
  app.style.setProperty('--grad-color-1', c1);
  app.style.setProperty('--grad-color-2', c2);
}

function applyEffects() {
  const acrylic = ACRYLICS.includes(state.settings.acrylic)
    ? state.settings.acrylic
    : 'low';

  app.dataset.acrylic = acrylic;
  document.body.classList.toggle('blur-off', !state.settings.blur);
}

function applyCompact() {
  document.body.classList.toggle('compact-settings', !!state.settings.compact);
  document.body.classList.toggle('hide-desc', !!state.settings.hideDesc);
}

function applyFont() {
  const key = state.settings.fontFamily || 'system';
  let family;

  if (key.startsWith('user:')) {
    const path = key.slice(5);
    const info = loadedFonts.get(path);
    family = info ? `"${info.familyName}", ${FONTS.system}` : FONTS.system;
  } else {
    family = FONTS[key] || FONTS.system;
  }

  document.documentElement.style.setProperty('--app-font', family);
}

function applyFontScale() {
  const key = state.settings.fontScale || 'medium';
  const scale = FONT_SCALES[key] || 1;
  document.documentElement.style.setProperty('--fs-scale', String(scale));
}

sizeRange.addEventListener('input', () => {
  state.settings.cardSize = Number(sizeRange.value);
  sizeVal.textContent = sizeRange.value;
  applyCardSize();
  scheduleSave();
});

ratioSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.settings.cardRatio = b.dataset.ratio;
  [...ratioSeg.children].forEach(x => x.classList.toggle('on', x === b));
  applyCardRatio();
  scheduleSave();
});

animSwitch.addEventListener('change', () => {
  state.settings.animations = animSwitch.checked;
  document.body.classList.toggle('no-anim', !animSwitch.checked);
  scheduleSave();
});

nameSwitch.addEventListener('change', () => {
  state.settings.showName = nameSwitch.checked;
  if (state.view !== 'settings') render();
  scheduleSave();
});

dateSwitch.addEventListener('change', () => {
  state.settings.showDate = dateSwitch.checked;
  if (state.view !== 'settings') render();
  scheduleSave();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  for (const [path, info] of loadedFonts.entries()) {
    if (info.url) URL.revokeObjectURL(info.url);
  }
  loadedFonts.clear();

  const preserved = {
    knownFolders: state.settings.knownFolders || [],
    expandedFolders: state.settings.expandedFolders || [],
    folderImportTime: state.settings.folderImportTime || {},
    folderSort: state.settings.folderSort || 'name',
    folderPaths: state.settings.folderPaths || {},
    folderOrder: state.settings.folderOrder || []
  };

  state.settings = {
    theme: 'system',
    gradMode: 'horizontal',
    gradColor1: '#3B82F6',
    gradColor2: '#06B6D4',
    fontFamily: 'system',
    fontScale: 'medium',
    customFonts: [],
    cardSize: 180,
    cardRatio: '4:3',
    animations: true,
    showName: true,
    showDate: true,
    acrylic: 'low',
    blur: true,
    compact: false,
    hideDesc: false,
    sorts: JSON.parse(JSON.stringify(DEFAULT_SORTS)),
    ...preserved
  };

  syncSettingsUI();
  syncFolderSortBtn();
  applyTheme();
  applyFont();
  applyFontScale();
  applyCardSize();
  applyCardRatio();
  applyGradient();
  applyEffects();
  applyCompact();
  document.body.classList.remove('no-anim');
  if (state.view !== 'settings') render();
  scheduleSave();
});

function renderFontSelect() {
  const labels = {
    system: '系统默认', yahei: '微软雅黑', dengxian: '等线',
    simsun: '宋体', simhei: '黑体', kaiti: '楷体',
    cascadia: 'Cascadia Code', consolas: 'Consolas'
  };
  const sys = Object.keys(FONTS).map(key =>
    `<option value="${key}">${labels[key] || key}</option>`
  ).join('');

  const users = state.settings.customFonts.map(f =>
    `<option value="user:${escapeHtml(f.path)}">${escapeHtml(f.name || baseName(f.path))}</option>`
  ).join('');

  fontSelect.innerHTML = sys + (users ? `<optgroup label="已导入字体">${users}</optgroup>` : '');
  fontSelect.value = state.settings.fontFamily || 'system';

  const isUser = (state.settings.fontFamily || '').startsWith('user:');
  removeFontBtn.hidden = !isUser;
}

function syncSettingsUI() {
  const s = state.settings;

  [...themeSeg.children].forEach(b => b.classList.toggle('on', b.dataset.theme === s.theme));

  const gradMode = GRAD_MODES[s.gradMode] ? s.gradMode : 'horizontal';
  [...gradModeSeg.children].forEach(b => {
    b.classList.toggle('on', b.dataset.mode === gradMode);
  });
  gradColor1.value = s.gradColor1 || '#3B82F6';
  gradColor2.value = s.gradColor2 || '#06B6D4';

  const acrylic = ACRYLICS.includes(s.acrylic) ? s.acrylic : 'low';
  [...acrylicSeg.children].forEach(b => {
    b.classList.toggle('on', b.dataset.acrylic === acrylic);
  });

  sizeRange.value = s.cardSize;
  sizeVal.textContent = s.cardSize;

  const ratio = s.cardRatio || '4:3';
  [...ratioSeg.children].forEach(b => {
    b.classList.toggle('on', b.dataset.ratio === ratio);
  });

  blurSwitch.checked = s.blur !== false;
  syncCompactSeg();

  const fs = FONT_SCALES[s.fontScale] ? s.fontScale : 'medium';
  [...fontSizeSeg.children].forEach(b => {
    b.classList.toggle('on', b.dataset.fs === fs);
  });

  animSwitch.checked = s.animations;
  nameSwitch.checked = s.showName;
  dateSwitch.checked = s.showDate;
  renderFontSelect();
}

/* =========================================================
   使用文档
   ========================================================= */
function showDocsDialog() {
  docsDialog.hidden = false;
  docsDialog.classList.toggle('dark', app.classList.contains('dark'));
  requestAnimationFrame(() => docsDialog.classList.add('show'));
}

function hideDocsDialog() {
  if (docsDialog.hidden) return;
  docsDialog.classList.remove('show');
  setTimeout(() => { docsDialog.hidden = true; }, 180);
}

docsBtn.addEventListener('click', showDocsDialog);
docsCloseBtn.addEventListener('click', hideDocsDialog);
docsDialog.querySelector('.docs-backdrop').addEventListener('click', hideDocsDialog);

/* =========================================================
   关于
   ========================================================= */
function showAboutDialog() {
  aboutDialog.hidden = false;
  aboutDialog.classList.toggle('dark', app.classList.contains('dark'));
  requestAnimationFrame(() => aboutDialog.classList.add('show'));
}

function hideAboutDialog() {
  if (aboutDialog.hidden) return;
  aboutDialog.classList.remove('show');
  setTimeout(() => { aboutDialog.hidden = true; }, 180);
}

aboutBtn.addEventListener('click', showAboutDialog);
aboutCloseBtn.addEventListener('click', hideAboutDialog);
aboutDialog.querySelector('.about-backdrop').addEventListener('click', hideAboutDialog);

/* =========================================================
   卡片交互
   ========================================================= */
grid.addEventListener('click', e => {
  if (suppressCardClick) return;

  const favBtn = e.target.closest('.fav-toggle');
  if (favBtn) {
    e.stopPropagation();
    toggleFavorite(Number(favBtn.dataset.fav));
    return;
  }
  const card = e.target.closest('.card');
  if (card) openViewer(Number(card.dataset.id));
});

grid.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.card');
  if (card) {
    e.preventDefault();
    openViewer(Number(card.dataset.id));
  }
});

function toggleFavorite(id) {
  const wasFav = state.favorites.has(id);
  if (wasFav) state.favorites.delete(id);
  else state.favorites.add(id);

  grid.querySelectorAll(`.fav-toggle[data-fav="${id}"]`).forEach(btn => {
    btn.classList.toggle('on', !wasFav);
  });

  if (state.view === 'fav' && wasFav) {
    const card = grid.querySelector(`.card[data-id="${id}"]`);
    if (card) card.remove();
    pageTitle.textContent = `${currentTitle()}（${grid.children.length}）`;
  }

  if (!viewer.hidden) {
    const p = vList[vIdx];
    if (p && p.id === id) viewerFav.classList.toggle('on', !wasFav);
  }

  updateFooter();
  scheduleSave();
}

/* =========================================================
   查看器：缩放 + 拖动 + 旋转
   ========================================================= */
const VIEWER_ZOOM_DEFAULT = 0.7;
const VIEWER_ZOOM_MIN     = 0.2;
const VIEWER_ZOOM_MAX     = 3;
const VIEWER_ZOOM_STEP    = 0.08;
const SLOW_ZOOM_STEP      = 0.02;
const SLOW_ROTATE_SPEED   = 90;

const ROTATE_UNSUPPORTED_EXTS = ['gif', 'svg'];

let viewerZoom = VIEWER_ZOOM_DEFAULT;
let viewerOffsetX = 0;
let viewerOffsetY = 0;
let viewerRotation = 0;

let slowRotateRaf    = null;
let slowRotateDir    = 0;
let slowRotateLastTs = 0;

let rotatingSaving = false;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;
let wasDragged = false;

function applyViewerTransform() {
  viewerImg.style.transform =
    `translate(${viewerOffsetX}px, ${viewerOffsetY}px) ` +
    `rotate(${viewerRotation}deg) scale(${viewerZoom})`;

  updateRotateSaveBtn();
}

function setViewerZoom(z) {
  viewerZoom = Math.min(VIEWER_ZOOM_MAX, Math.max(VIEWER_ZOOM_MIN, z));
  applyViewerTransform();
  zoomLabel.textContent = Math.round(viewerZoom * 100) + '%';
}

function resetViewerZoom() {
  stopSlowRotate();

  viewerZoom = VIEWER_ZOOM_DEFAULT;
  viewerOffsetX = 0;
  viewerOffsetY = 0;
  viewerRotation = 0;

  viewerImg.style.transition = 'none';
  applyViewerTransform();
  void viewerImg.offsetWidth;
  viewerImg.style.transition = '';

  zoomLabel.textContent = Math.round(viewerZoom * 100) + '%';
}

let vList = [];
let vIdx = 0;

function openViewer(id) {
  vList = getVisible();
  const i = vList.findIndex(p => p.id === id);
  if (i < 0) return;

  vIdx = i;
  viewer.hidden = false;
  requestAnimationFrame(() => viewer.classList.add('show'));

  resetViewerZoom();
  updateViewer();
}

function closeViewer() {
  stopSlowRotate();
  hideRenameDialog();
  hideMoveDialog();
  viewer.classList.remove('show');
  setTimeout(() => { viewer.hidden = true; }, 220);
}

function updateViewer() {
  const p = vList[vIdx];
  if (!p) return;

  resetViewerZoom();

  viewerImg.src = p.src;
  viewerImg.alt = p.name;

  const blurImg = document.getElementById('viewerBlurImg');
  if (blurImg) {
    blurImg.src = p.src;
  }

  viewerTitle.textContent = p.name;
  viewerSub.textContent = `${fmtDate(p.ts)} · ${formatSize(p.size)} · ${p.folder}`;
  viewerCount.textContent = `${vIdx + 1} / ${vList.length}`;

  viewerFav.classList.toggle('on', state.favorites.has(p.id));
  viewerFav.dataset.id = p.id;

  viewerImg.style.animation = 'none';
  void viewerImg.offsetWidth;
  viewerImg.style.animation = '';

  updateRotateSaveBtn();
}

function stepViewer(delta) {
  if (!vList.length) return;
  stopSlowRotate();
  vIdx = (vIdx + delta + vList.length) % vList.length;
  updateViewer();
}

function rotateViewer(delta) {
  viewerRotation += delta;
  applyViewerTransform();
}

function startSlowRotate(dir) {
  slowRotateDir = dir;

  if (slowRotateRaf !== null) return;

  slowRotateLastTs = performance.now();

  const tick = (now) => {
    if (slowRotateDir === 0) {
      slowRotateRaf = null;
      viewerImg.style.transition = '';
      return;
    }

    const dt = (now - slowRotateLastTs) / 1000;
    slowRotateLastTs = now;

    viewerRotation += slowRotateDir * SLOW_ROTATE_SPEED * dt;

    viewerImg.style.transition = 'none';
    applyViewerTransform();

    slowRotateRaf = requestAnimationFrame(tick);
  };

  slowRotateRaf = requestAnimationFrame(tick);
}

function stopSlowRotate() {
  slowRotateDir = 0;
}

function snapRotation(deg) {
  const d = ((deg % 360) + 360) % 360;
  const snapped = Math.round(d / 90) * 90;
  return snapped % 360;
}

function canSaveRotation(p) {
  if (!p) return false;
  if (rotatingSaving) return false;
  const ext = getFileExt(p.name);
  if (ROTATE_UNSUPPORTED_EXTS.includes(ext)) return false;
  return snapRotation(viewerRotation) !== 0;
}

function updateRotateSaveBtn() {
  if (!rotateSaveBtn) return;
  const p = vList[vIdx];
  const ok = canSaveRotation(p);
  rotateSaveBtn.disabled = !ok;

  if (ok) {
    const deg = snapRotation(viewerRotation);
    rotateSaveBtn.title = `保存旋转（${deg}°）`;
  } else {
    const ext = p ? getFileExt(p.name) : '';
    if (ROTATE_UNSUPPORTED_EXTS.includes(ext)) {
      rotateSaveBtn.title = '该格式不支持保存旋转';
    } else {
      rotateSaveBtn.title = '保存旋转';
    }
  }
}

function showViewerBusy(on) {
  if (!viewerBusy) return;
  if (on) {
    viewerBusy.hidden = false;
    requestAnimationFrame(() => viewerBusy.classList.add('show'));
  } else {
    viewerBusy.classList.remove('show');
    setTimeout(() => { viewerBusy.hidden = true; }, 200);
  }
}

if (rotateSaveBtn) {
  rotateSaveBtn.addEventListener('click', async () => {
    const p = vList[vIdx];
    if (!p) return;
    if (rotatingSaving) return;

    const deg = snapRotation(viewerRotation);
    if (deg === 0) return;

    if (!confirm(`将按 ${deg}° 旋转并覆盖原文件？\n（EXIF 元数据会丢失）`)) return;

    rotatingSaving = true;
    updateRotateSaveBtn();
    showViewerBusy(true);

    try {
      await invoke('rotate_image', { path: p.path, degrees: deg });

      p.thumb = null;
      p.src = convertFileSrc(p.path) + '?t=' + Date.now();

      try {
        const info = await stat(p.path);
        p.size = info.size || p.size;
        p.ts = info.mtime ? new Date(info.mtime).getTime() : p.ts;
      } catch (_) {}

      stopSlowRotate();
      viewerZoom = VIEWER_ZOOM_DEFAULT;
      viewerOffsetX = 0;
      viewerOffsetY = 0;
      viewerRotation = 0;
      applyViewerTransform();
      zoomLabel.textContent = Math.round(viewerZoom * 100) + '%';

      viewerImg.src = p.src;
      const blurImg = document.getElementById('viewerBlurImg');
      if (blurImg) blurImg.src = p.src;

      viewerSub.textContent = `${fmtDate(p.ts)} · ${formatSize(p.size)} · ${p.folder}`;

      renderFileList();
      render();
      updateFooter();
      scheduleSave();

      showToast(`已保存 ${deg}° 旋转`);
    } catch (err) {
      console.error('保存旋转失败：', err);
      alert('保存旋转失败：' + err);
    } finally {
      rotatingSaving = false;
      showViewerBusy(false);
      updateRotateSaveBtn();
    }
  });
}

viewer.addEventListener('wheel', e => {
  if (viewer.hidden) return;
  e.preventDefault();

  const dir = e.deltaY > 0 ? -1 : 1;

  if (e.shiftKey) {
    setViewerZoom(viewerZoom + dir * SLOW_ZOOM_STEP);
    return;
  }

  const step = VIEWER_ZOOM_STEP * (Math.abs(e.deltaY) > 50 ? 1.5 : 1);
  setViewerZoom(viewerZoom + dir * step);
}, { passive: false });

viewerImg.addEventListener('pointerdown', (e) => {
  if (e.button !== undefined && e.button !== 0) return;

  isDragging = true;
  wasDragged = false;

  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartOffsetX = viewerOffsetX;
  dragStartOffsetY = viewerOffsetY;

  viewerImg.style.transition = 'none';
  viewerImg.style.cursor = 'grabbing';

  try { viewerImg.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});

viewerImg.addEventListener('pointermove', (e) => {
  if (!isDragging) return;

  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragged = true;

  viewerOffsetX = dragStartOffsetX + dx;
  viewerOffsetY = dragStartOffsetY + dy;
  applyViewerTransform();
});

function endDrag(e) {
  if (!isDragging) return;
  isDragging = false;

  viewerImg.style.cursor = '';
  viewerImg.style.transition = '';

  try {
    if (e && e.pointerId !== undefined) {
      viewerImg.releasePointerCapture(e.pointerId);
    }
  } catch (_) {}

  setTimeout(() => { wasDragged = false; }, 300);
}

viewerImg.addEventListener('pointerup', endDrag);
viewerImg.addEventListener('pointercancel', endDrag);
viewerImg.addEventListener('pointerleave', endDrag);

viewerImg.addEventListener('dblclick', e => {
  e.stopPropagation();
  if (wasDragged) return;
  resetViewerZoom();
});

document.getElementById('viewerClose').addEventListener('click', closeViewer);
document.getElementById('viewerPrev').addEventListener('click', () => stepViewer(-1));
document.getElementById('viewerNext').addEventListener('click', () => stepViewer(1));
viewer.querySelector('.viewer-backdrop').addEventListener('click', closeViewer);
viewerFav.addEventListener('click', () => {
  const id = Number(viewerFav.dataset.id);
  if (!Number.isNaN(id)) toggleFavorite(id);
});

/* =========================================================
   顶部图标按钮
   ========================================================= */
document.getElementById('viewerWallpaper').addEventListener('click', async () => {
  const p = vList[vIdx];
  if (!p) return;
  try {
    await invoke('set_wallpaper', { path: p.path });
  } catch (err) {
    console.error('设为壁纸失败：', err);
    alert('设为壁纸失败：' + err);
  }
});

document.getElementById('viewerOpenWith').addEventListener('click', async () => {
  const p = vList[vIdx];
  if (!p) return;
  try {
    await invoke('open_with', { path: p.path });
  } catch (err) {
    console.error('打开失败：', err);
    alert('打开失败：' + err);
  }
});

document.getElementById('viewerRename').addEventListener('click', () => {
  const p = vList[vIdx];
  if (!p) return;
  const { base } = splitName(p.name);

  renameDialogMode = 'file';
  renameTargetPath = null;
  renameTitleEl.textContent = '重命名';
  renameInput.placeholder = '输入新的文件名';
  renameInput.value = base;

  renameDialog.hidden = false;
  requestAnimationFrame(() => {
    renameDialog.classList.add('show');
    renameInput.focus();
    renameInput.select();
  });
});

document.getElementById('viewerCopyPath').addEventListener('click', async () => {
  const p = vList[vIdx];
  if (!p) return;
  try {
    await navigator.clipboard.writeText(p.path);
    showToast('已复制路径');
  } catch (err) {
    alert('复制失败：' + err);
  }
});

document.getElementById('viewerReveal').addEventListener('click', async () => {
  const p = vList[vIdx];
  if (!p) return;
  try {
    await invoke('reveal_in_explorer', { path: p.path });
  } catch (err) {
    alert('打开失败：' + err);
  }
});

document.getElementById('viewerMove').addEventListener('click', () => {
  const p = vList[vIdx];
  if (!p) return;
  openMoveDialog(p);
});

document.getElementById('viewerDelete').addEventListener('click', async () => {
  const p = vList[vIdx];
  if (!p) return;
  if (!confirm(`将「${p.name}」移入回收站？`)) return;

  try {
    await invoke('delete_to_trash', { paths: [p.path] });

    const deletedId = p.id;
    PHOTOS = PHOTOS.filter(x => x.id !== deletedId);
    state.favorites.delete(deletedId);

    vList = getVisible();
    if (!vList.length) {
      closeViewer();
    } else {
      if (vIdx >= vList.length) vIdx = vList.length - 1;
      updateViewer();
    }

    renderFileList();
    render();
    updateFooter();
    scheduleSave();
  } catch (err) {
    alert('删除失败：' + err);
  }
});

/* =========================================================
   移动到对话框
   ========================================================= */
let movePhoto = null;
let moveTargetPath = null;

function folderVirtualToReal(virtualPath) {
  const folderPaths = state.settings.folderPaths || {};
  const parts = String(virtualPath).split('/');
  const rootName = parts[0];
  const rootDir = folderPaths[rootName];
  if (!rootDir) return null;
  if (parts.length === 1) return rootDir;

  const sep = rootDir.includes('\\') && !rootDir.includes('/') ? '\\' : '/';
  const rel = parts.slice(1).join(sep);
  return rootDir.endsWith('/') || rootDir.endsWith('\\')
    ? rootDir + rel
    : rootDir + sep + rel;
}

function openMoveDialog(photo) {
  movePhoto = photo;
  moveTargetPath = null;

  const roots = buildFolderTree();

  if (!roots.length) {
    moveList.innerHTML = `<div class="move-empty">还没有已导入的目录<br>请先点「选择其他文件夹…」</div>`;
  } else {
    moveList.innerHTML = roots.map(node => moveItemHtml(node, 0)).join('');
  }

  moveDialog.hidden = false;
  moveDialog.classList.toggle('dark', app.classList.contains('dark'));
  requestAnimationFrame(() => moveDialog.classList.add('show'));
}

function moveItemHtml(node, depth) {
  const indent = depth * 14;
  const realPath = folderVirtualToReal(node.path);

  if (!realPath) {
    return `
      <button class="move-item" disabled style="padding-left:${10 + indent}px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 7.4a2 2 0 0 1 2-2h3.1a1 1 0 0 1 .8.4l1.2 1.6h8a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>
        </svg>
        <span class="move-item-name">${escapeHtml(node.name)}（不可用）</span>
      </button>` +
      node.children.map(c => moveItemHtml(c, depth + 1)).join('');
  }

  const self = `
    <button class="move-item" data-path="${escapeHtml(realPath)}" style="padding-left:${10 + indent}px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 7.4a2 2 0 0 1 2-2h3.1a1 1 0 0 1 .8.4l1.2 1.6h8a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>
      </svg>
      <span class="move-item-name">${escapeHtml(node.name)}</span>
    </button>`;
  const kids = node.children.map(c => moveItemHtml(c, depth + 1)).join('');
  return self + kids;
}

function hideMoveDialog() {
  if (moveDialog.hidden) return;
  moveDialog.classList.remove('show');
  setTimeout(() => { moveDialog.hidden = true; }, 180);
  movePhoto = null;
  moveTargetPath = null;
}

moveList.addEventListener('click', e => {
  const item = e.target.closest('.move-item');
  if (!item) return;
  moveTargetPath = item.dataset.path;
  [...moveList.children].forEach(x => x.classList.toggle('on', x === item));
});

document.getElementById('moveCancel').addEventListener('click', hideMoveDialog);
moveDialog.querySelector('.move-backdrop').addEventListener('click', hideMoveDialog);

document.getElementById('movePickOther').addEventListener('click', async () => {
  let dir;
  try {
    dir = await open({ directory: true, multiple: false, title: '选择目标文件夹' });
  } catch (err) {
    alert('打开文件夹对话框失败：' + err);
    return;
  }
  if (!dir) return;

  moveTargetPath = dir;

  const name = baseName(dir) || dir;
  const tmp = document.createElement('button');
  tmp.className = 'move-item on';
  tmp.dataset.path = dir;
  tmp.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3.5 7.4a2 2 0 0 1 2-2h3.1a1 1 0 0 1 .8.4l1.2 1.6h8a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>
    </svg>
    <span class="move-item-name">${escapeHtml(name)}</span>`;
  [...moveList.children].forEach(x => x.classList.remove('on'));
  moveList.appendChild(tmp);
});

document.getElementById('moveConfirm').addEventListener('click', async () => {
  if (!movePhoto) { hideMoveDialog(); return; }
  if (!moveTargetPath) { alert('请先选择一个目标目录'); return; }

  const p = movePhoto;
  const dstDir = moveTargetPath;

  try {
    const ok = await exists(dstDir);
    if (!ok) { alert('目标目录不存在或已被移动'); return; }
  } catch (_) {}

  const currentDir = p.path.replace(/[\\/][^\\/]+$/, '');
  if (normalizePath(currentDir) === normalizePath(dstDir)) {
    hideMoveDialog();
    return;
  }

  try {
    const oldPath = p.path;
    const newPath = await invoke('move_file', { src: oldPath, dstDir });
    hideMoveDialog();

    invoke('rename_thumbnail_cache', {
      oldPaths: [oldPath],
      newPaths: [newPath],
      size: THUMB_SIZE
    }).catch(() => {});

    p.path = newPath;
    p.src = convertFileSrc(newPath) + '?t=' + Date.now();
    p.thumb = null;

    try {
      const info = await stat(newPath);
      p.size = info.size || p.size;
      p.ts   = info.mtime ? new Date(info.mtime).getTime() : p.ts;
    } catch (_) {}

    const folderPaths = state.settings.folderPaths || {};
    let newFolder = null;

    for (const [rootName, rootDir] of Object.entries(folderPaths)) {
      if (isInDir(newPath, rootDir)) {
        const rel = normalizePath(newPath)
          .slice(normalizePath(rootDir).replace(/\/+$/, '').length)
          .replace(/^\/+/, '');

        const relDir = rel.includes('/')
          ? rel.slice(0, rel.lastIndexOf('/'))
          : '';

        newFolder = relDir ? `${rootName}/${relDir}` : rootName;
        break;
      }
    }

    if (newFolder) {
      p.folder = newFolder;

      const knownSet = new Set(state.settings.knownFolders || []);
      knownSet.add(newFolder);
      state.settings.knownFolders = [...knownSet];
      markFolderImported(newFolder);
    } else {
      const rootName = baseName(dstDir) || dstDir;
      state.settings.folderPaths[rootName] = dstDir;

      const knownSet = new Set(state.settings.knownFolders || []);
      knownSet.add(rootName);
      state.settings.knownFolders = [...knownSet];

      p.folder = rootName;
      markFolderImported(rootName);
    }

    const oldId = p.id;
    vList = getVisible();
    const i = vList.findIndex(x => x.id === oldId);
    if (i >= 0) vIdx = i;

    renderFileList();
    render();
    updateViewer();
    updateFooter();
    scheduleSave();

    showToast('已移动到「' + (baseName(dstDir) || dstDir) + '」');
  } catch (err) {
    alert('移动失败：' + err);
  }
});

/* =========================================================
   重命名对话框（文件 / 文件夹 / 新建子目录共用）
   ========================================================= */
function hideRenameDialog() {
  if (renameDialog.hidden) return;
  renameDialog.classList.remove('show');
  setTimeout(() => { renameDialog.hidden = true; }, 180);
  renameDialogMode = 'file';
  renameTargetPath = null;
}

async function confirmRename() {
  const value = renameInput.value.trim();
  if (!value) {
    renameInput.focus();
    return;
  }

  if (renameDialogMode === 'file') {
    await confirmFileRename(value);
  } else if (renameDialogMode === 'folder') {
    if (!isValidFolderName(value)) {
      alert('名称不能包含 \\ / : * ? " < > |');
      renameInput.focus();
      return;
    }
    await confirmFolderRename(value);
  } else if (renameDialogMode === 'newFolder') {
    if (!isValidFolderName(value)) {
      alert('名称不能包含 \\ / : * ? " < > |');
      renameInput.focus();
      return;
    }
    await confirmCreateFolder(value);
  }
}

async function confirmFileRename(newBase) {
  const p = vList[vIdx];
  if (!p) { hideRenameDialog(); return; }

  const { ext } = splitName(p.name);
  const newName = newBase + ext;

  if (newName === p.name) {
    hideRenameDialog();
    return;
  }

  try {
    const oldPath = p.path;
    const newPath = await invoke('rename_file', {
      oldPath,
      newName: newBase
    });

    invoke('rename_thumbnail_cache', {
      oldPaths: [oldPath],
      newPaths: [newPath],
      size: THUMB_SIZE
    }).catch(() => {});

    p.name = newName;
    p.path = newPath;
    p.src  = convertFileSrc(newPath);
    p.thumb = null;

    updateViewer();
    renderFileList();
    render();
    scheduleSave();
    hideRenameDialog();
  } catch (err) {
    console.error('重命名失败：', err);
    alert('重命名失败：' + err);
  }
}

document.getElementById('renameCancel').addEventListener('click', hideRenameDialog);
document.getElementById('renameConfirm').addEventListener('click', confirmRename);
renameDialog.querySelector('.rename-backdrop').addEventListener('click', hideRenameDialog);

renameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmRename();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideRenameDialog();
  }
});

/* =========================================================
   全局键盘
   ========================================================= */
document.addEventListener('keydown', e => {
  if (!aboutDialog.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideAboutDialog();
    }
    return;
  }

  if (!docsDialog.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideDocsDialog();
    }
    return;
  }

  if (!moveDialog.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideMoveDialog();
    }
    return;
  }

  if (!folderRemoveDialog.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideFolderRemoveDialog();
    }
    return;
  }

  if (!renameDialog.hidden) return;
  if (viewer.hidden) return;

  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;
  }

  if (e.repeat) return;

  const k = e.key.toLowerCase();

  if (e.key === 'Escape') {
    e.preventDefault();
    closeViewer();
    return;
  }

  if (k === 'a' || e.key === 'ArrowLeft') {
    e.preventDefault();
    stepViewer(-1);
    return;
  }

  if (k === 'd' || e.key === 'ArrowRight') {
    e.preventDefault();
    stepViewer(1);
    return;
  }

  if (k === 'w' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (e.shiftKey) {
      startSlowRotate(-1);
    } else {
      stopSlowRotate();
      rotateViewer(-90);
    }
    return;
  }

  if (k === 's' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (e.shiftKey) {
      startSlowRotate(1);
    } else {
      stopSlowRotate();
      rotateViewer(90);
    }
    return;
  }

  if (k === 'r' || e.key === '0') {
    e.preventDefault();
    resetViewerZoom();
    return;
  }

  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    setViewerZoom(viewerZoom + VIEWER_ZOOM_STEP);
    return;
  }

  if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    setViewerZoom(viewerZoom - VIEWER_ZOOM_STEP);
    return;
  }
});

document.addEventListener('keyup', e => {
  if (viewer.hidden) return;

  const k = e.key.toLowerCase();

  const isRotateKey =
    k === 'w' || k === 's' ||
    e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
    e.key === 'Shift';

  if (isRotateKey) stopSlowRotate();
});

/* =========================================================
   初始化
   ========================================================= */
async function init() {
  await loadState();

  applyTheme();
  applyFont();
  applyFontScale();
  applyCardSize();
  applyCardRatio();
  applyGradient();
  applyEffects();
  applyCompact();
  document.body.classList.toggle('no-anim', !state.settings.animations);
  syncSettingsUI();
  syncFolderSortBtn();
  syncActiveNav();
  syncSortUI();
  renderFileList();
  updateFooter();
  render();

  viewerZoom = VIEWER_ZOOM_DEFAULT;
  viewerOffsetX = 0;
  viewerOffsetY = 0;
  viewerRotation = 0;
  applyViewerTransform();

  restoreCustomFonts();
  validatePhotosInBackground();
}

init();

/* =========================================================
   目录列表滚动时短暂显示滚动条
   ========================================================= */
(function () {
  const list = document.getElementById('fileList');
  if (!list) return;

  let timer = null;
  list.addEventListener('scroll', () => {
    list.classList.add('scrolling');
    clearTimeout(timer);
    timer = setTimeout(() => list.classList.remove('scrolling'), 700);
  }, { passive: true });
})();