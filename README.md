# 저축은행 업계 뉴스 허브

카카오톡으로 돌던 기사 링크(오래된 기사, 중복, 광고성 기사 혼재 문제)를 해결하기 위한
독립 뉴스 수집 웹사이트입니다.

- **수집 범위**: 저축은행 업계 전반 (OK저축은행, SBI/웰컴/페퍼/애큐온저축은행, 저축은행중앙회, 금리 등 9개 키워드)
- **수집 방식**: 네이버 뉴스 검색 오픈API, 30분마다 자동 수집
- **정리 로직**: 링크/제목 유사도로 같은 기사를 보도한 여러 매체를 하나로 묶고("외 N곳 보도"),
  72시간 이상 지난 기사는 제외하고, Gemini로 광고/보도자료/협찬성 콘텐츠를 걸러냄
- **프론트엔드**: 순수 HTML/CSS/JS, `docs/` 폴더 그대로 GitHub Pages로 호스팅
- **백엔드**: Cloudflare Worker + KV + Cron Trigger (완전 서버리스, 로컬 PC와 무관하게 상시 운영)

## 배포 순서 (Wrangler CLI 사용 — Cron/KV를 wrangler.toml이 한 번에 설정해줍니다)

### 1) Wrangler 설치 및 로그인

```
npm install -g wrangler
wrangler login
```

### 2) KV 네임스페이스 생성

```
cd worker
wrangler kv namespace create SB_NEWS
```

출력된 `id` 값을 `worker/wrangler.toml`의 `REPLACE_WITH_KV_NAMESPACE_ID` 부분에 붙여넣으세요.

### 3) 환경변수(Secret) 등록

```
wrangler secret put NAVER_CLIENT_ID
wrangler secret put NAVER_CLIENT_SECRET
wrangler secret put GEMINI_API_KEY
```

- 네이버 Client ID/Secret: 네이버 개발자센터에서 발급받은 값 (기존 CRMNewsBot에서 쓰던 값 재사용 가능)
- Gemini API Key: 기존 자비스에서 쓰는 Gemini API 키 재사용 가능

### 4) Worker 배포

```
wrangler deploy
```

배포 후 나오는 주소를 메모하세요. 예: `https://savings-bank-news.<계정이름>.workers.dev`
(이 명령 한 번으로 코드 + KV 바인딩 + 30분 Cron Trigger가 모두 설정됩니다.)

### 5) 프론트엔드 설정값 채우기

`docs/config.js`를 열어 `WORKER_BASE_URL`을 4번에서 메모한 주소로 바꾸세요.

### 6) GitHub Pages로 사이트 올리기

1. GitHub에 새 저장소 생성(예: `savings-bank-news`), 이 프로젝트 폴더 전체를 push
2. 저장소 **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main`, 폴더: `/docs` → Save
3. 몇 분 뒤 `https://<계정>.github.io/savings-bank-news/` 접속 확인

### 7) 최초 데이터 채우기

Cron은 배포 후 최대 30분 뒤에 첫 실행됩니다. 바로 확인하려면 브라우저에서
`https://<worker주소>/api/refresh` 를 한 번 열어 수동으로 즉시 수집시키세요.

## 알아둘 점

- `/api/refresh`는 인증이 없습니다. 공개된 뉴스 기사를 재수집하는 것뿐이라 민감정보가 아니라서
  누구나 호출해도 문제는 없지만, 남용되면 네이버/Gemini API 호출량이 늘어날 수 있습니다.
- 광고성 기사 필터링은 Gemini 판단에 의존하므로 100% 정확하지 않습니다. 오탐이 잦으면
  `worker/worker.js`의 `classifyAds` 프롬프트를 조정하세요.
- 중복 판정은 제목 유사도(바이그램 Jaccard ≥ 0.75) 기준입니다. 같은 사건을 다르게 쓴
  기사까지 묶이거나, 반대로 거의 같은데 안 묶이는 경우가 있을 수 있어 임계값은 조정 가능합니다.
- 키워드 목록은 `worker/worker.js`의 `KEYWORDS`에서 추가/삭제하세요.
