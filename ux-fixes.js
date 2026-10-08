(() => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function currentFileInput() {
    const top = document.getElementById('fileInput');
    const big = document.getElementById('fileInputBig');
    if (top?.files?.length) return top;
    if (big?.files?.length) return big;
    return null;
  }

  function fileKeyFromInput(input) {
    const file = input?.files?.[0];
    return file ? `${file.name}:${file.size}:${file.lastModified}` : null;
  }

  function rotationStorageKey(key) {
    return `leitor-rotations:${key}`;
  }

  function readRotations(key) {
    try {
      const value = JSON.parse(localStorage.getItem(rotationStorageKey(key)) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function inheritedRotationAt(map, page) {
    let value = 0;
    const keys = Object.keys(map)
      .map(Number)
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
    for (const key of keys) {
      if (key > page) break;
      value = Number(map[key] || 0);
    }
    return ((value % 360) + 360) % 360;
  }

  function writeRotationRange(key, start, end, rotation) {
    const map = readRotations(key);
    for (let page = start; page <= end; page++) map[page] = rotation;
    localStorage.setItem(rotationStorageKey(key), JSON.stringify(map));
  }

  function normalizeLegacyRotationRange(key, total) {
    const map = readRotations(key);
    const explicit = Object.keys(map).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    if (!explicit.length || explicit.length >= total) return false;
    const normalized = {};
    let current = 0;
    let index = 0;
    for (let page = 1; page <= total; page++) {
      while (index < explicit.length && explicit[index] === page) {
        current = Number(map[page] || 0);
        index++;
      }
      normalized[page] = ((current % 360) + 360) % 360;
    }
    localStorage.setItem(rotationStorageKey(key), JSON.stringify(normalized));
    return true;
  }

  function showToast(message) {
    let toast = document.getElementById('uxFixToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'uxFixToast';
      toast.className = 'ux-fix-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  let reloadTimer = null;
  function reloadSelectedFile(input, delay = 80) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (input?.files?.length) input.dispatchEvent(new Event('change', { bubbles: true }));
    }, delay);
  }

  function applyRotationFromHere(delta) {
    const input = currentFileInput();
    const key = fileKeyFromInput(input);
    const seek = document.getElementById('pageSeek');
    const start = Number(seek?.value || 0);
    const end = Number(seek?.max || 0);
    if (!input || !key || !start || !end || end < start) return;

    const map = readRotations(key);
    const current = inheritedRotationAt(map, start);
    const next = (current + delta + 360) % 360;
    writeRotationRange(key, start, end, next);
    showToast(`Giro ${next}° aplicado da página ${start} até o fim.`);
    reloadSelectedFile(input);
  }

  async function migrateLegacyRotation(input) {
    const key = fileKeyFromInput(input);
    if (!key || migrateLegacyRotation.done.has(key)) return;
    for (let attempt = 0; attempt < 40; attempt++) {
      const seek = document.getElementById('pageSeek');
      const total = Number(seek?.max || 0);
      if (total > 1) {
        migrateLegacyRotation.done.add(key);
        if (normalizeLegacyRotationRange(key, total)) reloadSelectedFile(input, 30);
        return;
      }
      await wait(50);
    }
  }
  migrateLegacyRotation.done = new Set();

  function installRotationRange() {
    const left = document.getElementById('rotateLeftBtn');
    const right = document.getElementById('rotateRightBtn');
    if (!left || !right) return;

    left.title = 'Girar 90° à esquerda desta página em diante';
    right.title = 'Girar 90° à direita desta página em diante';

    left.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyRotationFromHere(-90);
    }, true);
    right.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyRotationFromHere(90);
    }, true);

    for (const input of [document.getElementById('fileInput'), document.getElementById('fileInputBig')]) {
      input?.addEventListener('change', () => migrateLegacyRotation(input));
    }
  }

  function installPersistentAdjustments() {
    const controls = document.getElementById('controls');
    const toggle = document.getElementById('controlsToggle');
    const close = document.getElementById('controlsClose');
    const focus = document.getElementById('focusBtn');
    const home = document.getElementById('homeBackBtn');
    if (!controls || !toggle || !close) return;

    let keepOpen = false;
    toggle.addEventListener('click', () => { keepOpen = !controls.classList.contains('open'); }, true);
    close.addEventListener('click', () => { keepOpen = false; }, true);
    focus?.addEventListener('click', () => { keepOpen = false; }, true);
    home?.addEventListener('click', () => { keepOpen = false; }, true);

    const observer = new MutationObserver(() => {
      if (!keepOpen) return;
      if (controls.classList.contains('closing')) controls.classList.remove('closing');
      if (!controls.classList.contains('open')) queueMicrotask(() => controls.classList.add('open'));
    });
    observer.observe(controls, { attributes: true, attributeFilter: ['class'] });
  }

  function clarifyReturnButton() {
    const button = document.getElementById('returnJumpBtn');
    if (!button) return;
    button.textContent = '↩ Onde eu estava';
    button.title = 'Voltar ao ponto de leitura anterior ao salto';
    button.setAttribute('aria-label', button.title);
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .ux-fix-toast{position:fixed;left:50%;bottom:118px;transform:translate(-50%,14px);z-index:130;background:rgba(15,23,42,.94);color:#fff;padding:10px 14px;border-radius:999px;font:700 12px/1.2 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:.18s ease;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}.ux-fix-toast.show{opacity:1;transform:translate(-50%,0)}
      @media(max-width:760px){.ux-fix-toast{bottom:112px}}
    `;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    installRotationRange();
    installPersistentAdjustments();
    clarifyReturnButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();