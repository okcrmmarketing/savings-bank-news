(function () {
  const BASE = window.APP_CONFIG.WORKER_BASE_URL;
  const listEl = document.getElementById('newsList');
  const emptyEl = document.getElementById('emptyState');
  const chipsEl = document.getElementById('keywordChips');
  const updatedAtEl = document.getElementById('updatedAt');
  const refreshBtn = document.getElementById('refreshBtn');
  const pagerEl = document.getElementById('pager');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageIndicatorEl = document.getElementById('pageIndicator');
  const datelineDateEl = document.getElementById('datelineDate');
  const datelineCountEl = document.getElementById('datelineCount');
  const exclusiveFillerEl = document.getElementById('exclusiveFiller');
  const sectionIndexEl = document.getElementById('sectionIndex');

  const PAGE_SIZE = 5;
  const LEAD_DESC_MAX = 120;
  const TIER2_DESC_MAX = 90;
  const DESC_MAX = 70;

  function truncate(text, max) {
    if (!text || text.length <= max) return text;
    return text.slice(0, max).trimEnd() + '…';
  }

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function renderDateline(articleCount) {
    const now = new Date();
    const dateText = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEKDAYS[now.getDay()]}요일`;
    datelineDateEl.textContent = dateText;
    datelineCountEl.textContent = `오늘 기사 ${articleCount}건`;
    exclusiveFillerEl.textContent =
      `${dateText} · 오늘 수집 ${articleCount}건 · 네이버 뉴스 검색 기반 · 30분마다 자동 갱신`;
  }

  // 하단 섹션 인덱스: 가짜 페이지 번호 대신 키워드별 실제 수집 건수
  function renderSectionIndex(articles) {
    const counts = new Map();
    articles.forEach((a) => {
      a.keywords.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
    });
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    sectionIndexEl.innerHTML = sorted
      .map(([k, n]) => `<span>${k}<span class="n">${n}</span></span>`)
      .join('');
  }

  let allArticles = [];
  let activeKeyword = '전체';
  let currentPage = 0;

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

  // 기사 하나를 카드 DOM으로 변환. extraClass로 위계(card-lead/card-tier2/card-block) 지정,
  // withStrap이면 왼쪽에 실제 키워드로 된 세로 스트랩 라벨을 붙인다(레퍼런스의 "THERE" 같은 세로 글자).
  function buildCardEl(a, extraClass, descMax, withStrap, showPhoto) {
    const card = document.createElement('div');
    card.className = 'card' + (extraClass ? ' ' + extraClass : '') + (withStrap ? ' has-strap' : '');

    const sourceCountText =
      a.otherSources && a.otherSources.length > 0
        ? ` · 외 ${a.otherSources.length}곳 보도`
        : '';

    const keywordText = a.keywords.map((k) => `<span class="kw">${k}</span>`).join(', ');

    // 실제 기사 대표 이미지가 있을 때만, 그리고 지정된 경우에만 표시.
    // 레퍼런스 지면처럼 사진은 톱기사 하나에만 쓰고 나머지는 헤드라인+텍스트 위주로 둔다.
    const photoHtml = showPhoto && a.image
      ? `<img class="card-photo" src="${a.image}" alt="" loading="lazy">`
      : '';

    const strapHtml = withStrap
      ? `<div class="strap">${a.keywords[0] || a.source}</div>`
      : '';

    const desc = truncate(a.description, descMax);

    card.innerHTML = `
      ${strapHtml}
      <div class="card-rule"></div>
      <div class="card-body">
        ${photoHtml}
        <div class="card-head">
          <a class="card-title" href="${a.link}" target="_blank" rel="noopener">${a.title}</a>
          <span class="card-time">${relativeTime(a.pubDate)}</span>
        </div>
        <p class="card-desc">${desc}</p>
        <div class="card-meta">${a.source}${sourceCountText} · ${keywordText}</div>
      </div>
    `;
    return card;
  }

  function render() {
    const filtered =
      activeKeyword === '전체'
        ? allArticles
        : allArticles.filter((a) => a.keywords.includes(activeKeyword));

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages - 1) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;

    const pageItems = filtered.slice(
      currentPage * PAGE_SIZE,
      currentPage * PAGE_SIZE + PAGE_SIZE
    );

    listEl.innerHTML = '';
    emptyEl.hidden = filtered.length > 0;
    pagerEl.hidden = filtered.length <= PAGE_SIZE;
    pageIndicatorEl.textContent = `${currentPage + 1} / ${totalPages}`;
    prevPageBtn.disabled = currentPage === 0;
    nextPageBtn.disabled = currentPage >= totalPages - 1;

    const isFrontPage = currentPage === 0;
    listEl.classList.toggle('front-page', isFrontPage);

    if (isFrontPage) {
      // 1면: 톱기사 + 세컨드 헤드라인 + 하단 3단 블록(콜라주 레이아웃)
      const [lead, tier2, ...blocks] = pageItems;
      if (lead) listEl.appendChild(buildCardEl(lead, 'card-lead', LEAD_DESC_MAX, true, true));
      if (tier2) listEl.appendChild(buildCardEl(tier2, 'card-tier2', TIER2_DESC_MAX, true, false));
      if (blocks.length) {
        const blockRow = document.createElement('div');
        blockRow.className = 'block-row';
        blocks.forEach((a) => {
          blockRow.appendChild(buildCardEl(a, 'card-block', DESC_MAX, true, false));
        });
        listEl.appendChild(blockRow);
      }
    } else {
      pageItems.forEach((a) => {
        listEl.appendChild(buildCardEl(a, '', DESC_MAX, false, true));
      });
    }
  }

  const FLIP_MS = 280;

  // HUD 티커 플립시계와 같은 3단계 패턴: 뒤집기 → 내용 교체 → 반대쪽에서 열기.
  // 페이지를 넘길 때 한 번만 재생되고, 반복되는 애니메이션은 아니다.
  function flipToPage(page, direction) {
    const outClass = direction === 'next' ? 'flip-out-next' : 'flip-out-prev';
    const inPrepClass = direction === 'next' ? 'flip-in-prep-next' : 'flip-in-prep-prev';

    listEl.classList.add(outClass);
    setTimeout(() => {
      currentPage = page;
      render();
      listEl.classList.remove(outClass);
      listEl.classList.add(inPrepClass);
      void listEl.offsetWidth;
      listEl.classList.remove(inPrepClass);
    }, FLIP_MS);
  }

  function goToPage(page) {
    if (page === currentPage) return;
    flipToPage(page, page > currentPage ? 'next' : 'prev');
  }

  prevPageBtn.onclick = () => { if (currentPage > 0) goToPage(currentPage - 1); };
  nextPageBtn.onclick = () => { goToPage(currentPage + 1); };

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
        currentPage = 0;
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
      renderDateline(allArticles.length);
      renderSectionIndex(allArticles);
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
