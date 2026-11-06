(function () {
  const BASE = window.APP_CONFIG.WORKER_BASE_URL;
  const listEl = document.getElementById('newsList');
  const emptyEl = document.getElementById('emptyState');
  const chipsEl = document.getElementById('keywordChips');
  const updatedAtEl = document.getElementById('updatedAt');
  const refreshBtn = document.getElementById('refreshBtn');

  let allArticles = [];
  let activeKeyword = '전체';

  function relativeTime(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return '방금 전';
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    return `${day}일 전`;
  }

  function render() {
    const filtered =
      activeKeyword === '전체'
        ? allArticles
        : allArticles.filter((a) => a.keywords.includes(activeKeyword));

    listEl.innerHTML = '';
    emptyEl.hidden = filtered.length > 0;

    for (const a of filtered) {
      const card = document.createElement('div');
      card.className = 'card';

      const sourceCountBadge =
        a.otherSources && a.otherSources.length > 0
          ? `<span class="badge">외 ${a.otherSources.length}곳 보도</span>`
          : '';

      const keywordBadges = a.keywords
        .map((k) => `<span class="badge keyword">${k}</span>`)
        .join('');

      card.innerHTML = `
        <div class="card-head">
          <a class="card-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
          <span class="card-time">${relativeTime(a.pubDate)}</span>
        </div>
        <p class="card-desc">${a.description}</p>
        <div class="card-meta">
          <span class="badge">${a.source}</span>
          ${sourceCountBadge}
          ${keywordBadges}
        </div>
      `;
      listEl.appendChild(card);
    }
  }

  function renderChips() {
    const keywordSet = new Set();
    allArticles.forEach((a) => a.keywords.forEach((k) => keywordSet.add(k)));
    const keywords = ['전체', ...keywordSet];

    chipsEl.innerHTML = '';
    keywords.forEach((k) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (k === activeKeyword ? ' active' : '');
      chip.textContent = k;
      chip.onclick = () => {
        activeKeyword = k;
        renderChips();
        render();
      };
      chipsEl.appendChild(chip);
    });
  }

  async function load(forceRefresh) {
    updatedAtEl.textContent = '불러오는 중...';
    try {
      const endpoint = forceRefresh ? '/api/refresh' : '/api/news';
      const resp = await fetch(BASE + endpoint);
      const data = await resp.json();
      allArticles = data.articles || [];
      updatedAtEl.textContent = '업데이트: ' + relativeTime(data.updatedAt);
      renderChips();
      render();
    } catch (err) {
      updatedAtEl.textContent = '불러오기 실패';
      console.error(err);
    }
  }

  refreshBtn.onclick = () => load(true);

  load(false);
  setInterval(() => load(false), 5 * 60 * 1000);
})();
