(() => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  function readRules(key) {
    try {
      const value = JSON.parse(localStorage.getItem(`leitor-split-rules:${key}`) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function writeRange(key, start, end, mode) {
    const storageKey = `leitor-split-rules:${key}`;
    const before = readRules(key).filter(rule => Number.isInteger(rule.page) && rule.page < start);
    for (let page = start; page <= end; page++) before.push({ page, mode });
    localStorage.setItem(storageKey, JSON.stringify(before));
  }

  function refreshButtonLabel(button) {
    if (!button) return;
    const active = button.classList.contains('active');
    const label = button.querySelector('.tool-label');
    const icon = button.querySelector('.tool-icon');
    const wanted = active ? 'Parar daqui →' : 'Dividir daqui →';
    const wantedIcon = active ? '▣' : '✂';
    const title = active
      ? 'Manter esta folha e as próximas inteiras'
      : 'Dividir esta folha e todas as próximas';
    if (label && label.textContent !== wanted) label.textContent = wanted;
    if (icon && icon.textContent !== wantedIcon) icon.textContent = wantedIcon;
    if (button.title !== title) button.title = title;
    if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
  }

  function showToast(message) {
    let toast = document.getElementById('splitRangeToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'splitRangeToast';
      toast.className = 'split-range-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
  }

  function compactRuleReview() {
    const review = document.getElementById('ruleReview');
    if (!review) return;
    const buttons = [...review.querySelectorAll('button')];
    let previousPage = null;
    let previousMode = null;
    for (const button of buttons) {
      const match = button.textContent.match(/Página\s+(\d+)\s+·\s+(Dividir|Pausar|Automático)/i);
      if (!match) continue;
      const page = Number(match[1]);
      const mode = match[2].toLowerCase();
      const contiguousDuplicate = previousPage !== null && page === previousPage + 1 && mode === previousMode;
      button.hidden = contiguousDuplicate;
      if (!contiguousDuplicate) {
        button.textContent = `A partir da página ${page} · ${mode === 'dividir' ? 'Dividir' : mode === 'pausar' ? 'Página inteira' : 'Automático'}`;
      }
      previousPage = page;
      previousMode = mode;
    }
  }

  async function applyFromHere(button) {
    const seek = document.getElementById('pageSeek');
    const input = currentFileInput();
    const key = fileKeyFromInput(input);
    const start = Number(seek?.value || 0);
    const end = Number(seek?.max || 0);
    if (!key || !start || !end || end < start) return;

    const desiredMode = button.classList.contains('active') ? 'whole' : 'split';

    // O listener original altera a folha atual. Quando essa alteração aparece
    // no armazenamento, ampliamos a mesma decisão até a última folha.
    for (let attempt = 0; attempt < 40; attempt++) {
      await wait(50);
      const current = readRules(key).find(rule => rule.page === start)?.mode;
      if (current === desiredMode) break;
    }

    writeRange(key, start, end, desiredMode);
    await wait(20);

    // Reprocessa o mesmo arquivo já selecionado para sincronizar as regras
    // mantidas em memória pelo leitor. Não abre o seletor de arquivos.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    showToast(desiredMode === 'split'
      ? `Divisão aplicada da página ${start} até o fim.`
      : `Página inteira aplicada da página ${start} até o fim.`);
  }

  function init() {
    const button = document.getElementById('splitQuickBtn');
    if (!button) return;

    const style = document.createElement('style');
    style.textContent = `
      .split-range-toast{position:fixed;left:50%;bottom:118px;transform:translate(-50%,18px);z-index:120;background:rgba(15,23,42,.94);color:#fff;padding:10px 14px;border-radius:999px;font:700 12px/1.2 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:.18s ease;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis}.split-range-toast.show{opacity:1;transform:translate(-50%,0)}
      @media(max-width:760px){#splitQuickBtn{min-height:42px;padding-left:11px;padding-right:11px}.split-range-toast{bottom:112px}}
    `;
    document.head.appendChild(style);

    refreshButtonLabel(button);
    const buttonObserver = new MutationObserver(() => refreshButtonLabel(button));
    buttonObserver.observe(button, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });

    button.addEventListener('click', () => applyFromHere(button), true);

    const review = document.getElementById('ruleReview');
    if (review) {
      const reviewObserver = new MutationObserver(compactRuleReview);
      reviewObserver.observe(review, { childList: true });
      compactRuleReview();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();