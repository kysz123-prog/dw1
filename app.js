// ===== 설정 (여기만 고치면 됨) =====
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxT5-lAhEZetpBkVQdGbriYU2ClTeGtx9-WRPFuG13NzObmqOP5IzRPpEX0-KajcGU2TA/exec";                                // 구글 앱스 스크립트 웹앱 주소 (비워 두면 전송 안 함)
const MINUTES = {
  basic: 60,
  adv: { 50: 17, 100: 25, 200: 50 }
};
const PASS = 80;                                         // 통과 점수(100점 만점)
const IMG = { pass: "img/pass.webp", fail: "img/fail.webp" };
Object.values(IMG).forEach(s => { new Image().src = s; });   // 결과 사진 미리 불러오기
const CHOICE_MIN = 6, CHOICE_MAX = 8;                  // 보기 개수 6~8개로 확대 (난이도 상향)

// 불러오기 실패 때 쓰는 테스트용 샘플
const SAMPLE = { basic: [
  { id: "s1", text: "1. 핵심 정리\n구분\t내용\n갈래\t{{blank}}\n성격\t{{blank}}, 애상적, {{blank}}\n제재\t{{blank}}\n주제\t누이의 죽음으로 인한 슬픔과 {{blank}}의 소망", answers: ["향가", "추모적", "종교적", "누이의 죽음", "재회"] },
  { id: "s2", text: "2. 향가의 표기 방식인 향찰\n향찰(鄉札)은 중국 글자인 한자를 빌려서 우리말을 적은 {{blank}}(借字) 표기의 일종이다. 한자를 빌려 표기하는 방법은 두 가지로 나뉜다. 하나는 한자의 음을 빌려다 쓰는 {{blank}}(音借) 방식이고, 다른 하나는 그 뜻을 빌려 쓰는 {{blank}}(訓借) 방식이다.", answers: ["차자", "음차", "훈차"] }
] };

// ===== 상태 =====
let DATA = null, level = "basic", count = null;
let quiz = [], idx = 0, bi = 0, answers = [], startedAt = 0, timerId = null, deadline = 0, finished = false;
const $ = id => document.getElementById(id);

// ===== 유틸 =====
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => s.replace(/\s+/g, "");
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const show = id => ["start", "quiz", "result", "notes"].forEach(v => $(v).hidden = v !== id);
// 문단 글 → HTML: \t 있는 줄은 표의 한 행(첫 행은 머리글), 소제목 줄은 굵게. {{blank}} 자리는 그대로 둠
const isHead = l => l.length < 40 && !l.includes("{{blank}}") && /^(\d+\.|\(\d+\)|[①-⑳])\s/.test(l);
function layout(t) {
  const out = []; let rows = [];
  const flush = () => {
    if (!rows.length) return;
    const grid = rows.map(r => r.split("\t").map(c => ({ text: c, rowspan: 1, colspan: 1, skip: false })));
    const R = grid.length;
    for (let r = 0; r < R; r++) {
      const C = grid[r].length;
      for (let c = 0; c < C; c++) {
        const val = grid[r][c].text.trim();
        if (val === "^") {
          grid[r][c].skip = true;
          for (let pr = r - 1; pr >= 0; pr--) {
            if (!grid[pr][c].skip) {
              grid[pr][c].rowspan += 1;
              break;
            }
          }
        } else if (val === "<") {
          grid[r][c].skip = true;
          for (let pc = c - 1; pc >= 0; pc--) {
            if (!grid[r][pc].skip) {
              grid[r][pc].colspan += 1;
              break;
            }
          }
        }
      }
    }
    let html = "<table>";
    for (let r = 0; r < R; r++) {
      html += "<tr>";
      const tag = r === 0 ? "th" : "td";
      for (let c = 0; c < grid[r].length; c++) {
        const cell = grid[r][c];
        if (cell.skip) continue;
        const attr = (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "") +
                     (cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "");
        const formatted = cell.text.replace(/(.)\s*•\s*/g, "$1<br>• ");
        const alignStyle = cell.text.includes("•") ? ' style="text-align:left; padding-left:10px;"' : '';
        html += `<${tag}${attr}${alignStyle}>${formatted}</${tag}>`;
      }
      html += "</tr>";
    }
    html += "</table>";
    out.push(html);
    rows = [];
  };
  for (const l of esc(t).split("\n")) {
    if (l.includes("\t")) rows.push(l);
    else { flush(); out.push(`<p${isHead(l) ? ' class="h"' : ""}>${l.replace(/(.)\s*•\s*/g, "$1<br>• ")}</p>`); }
  }
  flush();
  return out.join("");
}
const p2 = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;  // 시트가 날짜·시각으로 알아보는 형식
const fmt = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

// ===== 데이터 불러오기 =====
async function load() {
  if (window.QUESTIONS) { DATA = window.QUESTIONS; checkResume(); return retryPending(); }   // 더블클릭으로 열어도 동작
  try {
    const r = await fetch("questions.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    DATA = SAMPLE; failMsg = "문제 파일을 못 불러와 샘플로 실행 중입니다. ";
    refreshStart();
  }
  checkResume();
  retryPending();
}

// ===== 시작 화면 =====
let failMsg = "";
function refreshStart() {
  const isAdv = level === "adv";
  $("countWrap").hidden = !isAdv;
  let note = "";
  if (!isAdv) {
    note = `기본형: 총 51문항(빈칸 201개) · 제한 ${MINUTES.basic}분`;
    $("go").disabled = !$("name").value.trim();
  } else {
    note = count ? `심화형: 빈칸 약 ${count}개 · 제한 ${MINUTES.adv[count]}분` : "문제 수를 선택해 주세요 (50개 / 100개 / 200개)";
    $("go").disabled = !(count && $("name").value.trim());
  }
  $("info").textContent = failMsg + note;
}
function bindGroup(groupId, attr, setter) {
  $(groupId).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    [...$(groupId).children].forEach(x => x.classList.toggle("on", x === b));
    setter(b.dataset[attr]); refreshStart();
  });
}
bindGroup("levelGroup", "level", v => {
  level = v;
  if (level === "adv" && !count) {
    count = 50;
    const btns = $("countGroup").querySelectorAll("button");
    if (btns.length) {
      btns.forEach(x => x.classList.toggle("on", x.dataset.count === "50"));
    }
  }
});
bindGroup("countGroup", "count", v => count = +v);
$("name").addEventListener("input", refreshStart);
$("go").addEventListener("click", startQuiz);
$("again").addEventListener("click", () => { show("start"); });

// ===== 출제 =====
// 같은 단원 오답: 문항은 원본 순서대로라 앞뒤 NEAR문단의 정답을 오답 후보로 씀(모자라면 범위를 넓힘)
const NEAR = 10;
function nearPool(all, qi, used) {
  for (let r = NEAR; ; r *= 2) {
    const seen = new Set(), pool = [];
    for (const x of all.slice(Math.max(0, qi - r), qi + r + 1))
      for (const w of x.answers) if (!used.has(norm(w)) && !seen.has(norm(w))) { seen.add(norm(w)); pool.push(w); }
    if (pool.length >= CHOICE_MAX * 2 || r >= all.length) return pool;
  }
}
// 같은 범주 묶음: 정답이 여기 들어 있으면 같은 묶음의 다른 말을 먼저 오답으로 넣음(when이 있으면 문항 글에 그 말이 있을 때만)
const GROUPS = [
  // 1. 갈래
  { words: ["향가", "고려가요", "시조", "가사", "민요", "경기체가", "악장", "신체시"] },
  { words: ["서정 가사", "양반 가사", "정격 가사", "변격 가사", "내방 가사", "기행 가사"] },
  { words: ["고전 소설", "판소리계 소설", "애정 소설", "영웅 소설", "군담 소설", "가정 소설"] },
  { words: ["현대 소설", "단편 소설", "농촌 소설", "성장 소설", "역사 소설"] },
  { words: ["자유시", "정형시", "산문시"] },
  { words: ["서정시", "서사시", "극시"] },
  { words: ["평시조", "사설시조", "엇시조", "연시조"] },

  // 2. 형식 및 구성
  { words: ["4구체", "8구체", "10구체"] },
  { words: ["초장", "중장", "종장"] },
  { words: ["기", "서", "결"] },
  { words: ["기", "승", "전", "결"] },
  { words: ["발단", "전개", "위기", "절정", "결말"] },
  { words: ["3장", "6구", "45자 내외", "4음보", "3음보"] },
  { words: ["순행적 구성", "역순행적 구성", "액자식 구성", "평면적 구성", "입체적 구성"] },
  { words: ["운문체", "산문체"] },
  { words: ["한자어", "일상어", "순우리말", "방언"] },

  // 3. 성격, 어조, 미의식
  { words: ["추모적", "애상적", "종교적", "회고적", "감상적", "예찬적", "비판적"] },
  { words: ["해학적", "풍자적", "염정적", "향토적", "일상적", "경험적"] },
  { words: ["풍자", "해학", "냉소", "조소"] },
  { words: ["숭고미", "우아미", "비장미", "골계미"] },

  // 4. 태도 및 심리
  { words: ["소극적", "적극적", "순응적", "저항적", "체념적", "달관적"] },
  { words: ["의지적", "진취적", "수동적", "소극적"] },
  { words: ["지속적", "일시적", "순간적"] },
  { words: ["연민", "포용", "공감", "냉대", "적대감"] },
  { words: ["고뇌", "슬픔", "탄식", "절망", "안타까움", "무상감"] },
  { words: ["정절", "수절", "변절", "절개"] },
  { words: ["충신연주지사", "연군지정", "우국지정", "안빈낙도", "유유자적"] },
  { words: ["대리 만족", "카타르시스", "정화", "신명"] },

  // 5. 시상 전개 및 표현 기법
  { words: ["비유", "상징", "역설", "반어", "도치", "대구", "설의", "영탄"] },
  { words: ["점층적", "점강적", "연쇄적", "반복적"] },
  { words: ["의인화", "활유", "환유", "제유"] },
  { words: ["감각적 이미지", "시각적 이미지", "청각적 이미지", "촉각적 이미지", "공감각적 이미지"] },
  { words: ["객관적 상관물", "감정이입", "매개체", "복선"] },
  { words: ["서술자의 개입", "편집자적 논평", "말하기", "보여주기"] },
  { words: ["장면의 극대화", "부분의 독자성", "확장적 문체"] },

  // 6. 국어 문법 및 표기
  { words: ["차자", "음차", "훈차", "훈독", "음독"] },
  { words: ["어간", "어미", "접사", "어근"] },
  { words: ["명사", "대명사", "수사", "동사", "형용사", "관형사", "부사", "조사", "감탄사"] },
  { words: ["체언", "용언", "수식언", "관계언", "독립언"] },
  { words: ["주성분", "부속 성분", "독립 성분"] },
  { words: ["주어", "서술어", "목적어", "보어", "관형어", "부사어", "독립어"] },

  // 7. 근원 설화 및 주제
  { words: ["열녀 설화", "관탈 민녀 설화", "신원 설화", "염정 설화", "암행어사 설화"] },
  { words: ["표면적 주제", "이면적 주제"] },
  { words: ["인간 해방", "신분 상승", "봉건 윤리", "유교적 이념"] },
  { words: ["탐관오리", "불의한 지배층", "부패한 지방 수령"] },

  // 8. 문법 요소: 높임법
  { words: ["주체 높임법", "객체 높임법", "상대 높임법"] },
  { words: ["주체 높임", "객체 높임", "상대 높임"] },
  { words: ["직접 높임", "간접 높임"] },
  { words: ["격식체", "비격식체"] },
  { words: ["하십시오체", "하오체", "하게체", "해라체"] },
  { words: ["해요체", "해체"] },

  // 9. 상대 높임 종결 어미
  { words: ["합니다", "합니까?", "하십시오", "하시지요"] },
  { words: ["하오", "하오?", "하구려", "합시다", "하는구려"] },
  { words: ["하네", "함세", "하는가?", "하나?", "하게", "하세", "하는구먼"] },
  { words: ["한다", "하니?", "하느냐?", "해라", "하자", "하는구나"] },
  { words: ["해요", "하지요", "해요?", "하지요?", "하군요"] },
  { words: ["해", "하지", "해?", "하지?", "하군"] },

  // 10. 문법 요소: 시제/피동/사동/부정
  { words: ["과거 시제", "현재 시제", "미래 시제"] },
  { words: ["능동", "피동"] },
  { words: ["주동", "사동"] },
  { words: ["안 부정문", "못 부정문"] }
];
const ALL_HON_ENDINGS = [
  "합니다", "합니까?", "하십시오", "하시지요",
  "하오", "하오?", "하구려", "합시다", "하는구려",
  "하네", "함세", "하는가?", "하나?", "하게", "하세", "하는구먼",
  "한다", "하니?", "하느냐?", "해라", "하자", "하는구나",
  "해요", "하지요", "해요?", "하지요?", "하군요",
  "해", "하지", "해?", "하지?", "하군"
];
const HON_GRADES = ["하십시오체", "하오체", "하게체", "해라체", "해요체", "해체"];
const HON_TYPES = ["격식체", "비격식체"];

function groupMates(a, q) {
  const g = GROUPS.find(g => g.words.some(w => norm(w) === norm(a)) && (!g.when || g.when.test(q.text)));
  return g ? g.words.filter(w => norm(w) !== norm(a)) : [];
}
function makeChoices(q, all) {        // 빈칸마다 헷갈리는 보기 세트 생성 (6~8지선다)
  const isHonQ = q.text.includes("상대 높임");
  const used = new Set(q.answers.map(norm));
  const defaultPool = nearPool(all, all.indexOf(q), used);

  return q.answers.map(a => {
    const na = norm(a);
    if (na === "×" || na === "x") return shuffle(["×", "○", "△", "-", "없음"]);
    if (HON_TYPES.some(w => norm(w) === na)) return shuffle(HON_TYPES.slice());
    if (HON_GRADES.some(w => norm(w) === na)) return shuffle(HON_GRADES.slice());

    // 상대 높임 종결 어미는 오직 종결 어미 풀에서만 오답을 보충(엉뚱한 품사 노출 방지)
    const isHonEnding = ALL_HON_ENDINGS.some(w => norm(w) === na) || isHonQ;
    const pool = isHonEnding
      ? ALL_HON_ENDINGS.filter(w => norm(w) !== na)
      : defaultPool;

    const n = Math.min(CHOICE_MIN + Math.floor(Math.random() * (CHOICE_MAX - CHOICE_MIN + 1)), pool.length + 1);
    const mates = shuffle(groupMates(a, q)).slice(0, n - 1);
    const have = new Set([na, ...mates.map(norm)]);
    const wrong = [...mates, ...shuffle(pool).filter(w => !have.has(norm(w))).slice(0, n - 1 - mates.length)];
    return shuffle([a, ...wrong]);
  });
}
function startQuiz() {
  const pool = (DATA && DATA[level]) || (level === "basic" ? SAMPLE.basic : SAMPLE.adv || SAMPLE.basic);
  quiz = [];
  let limit = MINUTES.basic;
  if (level === "basic") {
    for (const q of shuffle(pool)) { quiz.push({ q, choices: makeChoices(q, pool) }); }
    limit = MINUTES.basic;
  } else {
    let sum = 0;
    for (const q of shuffle(pool)) {
      if (sum >= count) break;
      quiz.push({ q, choices: makeChoices(q, pool) });
      sum += q.answers.length;
    }
    limit = (MINUTES.adv && MINUTES.adv[count]) || 25;
  }
  clearTimeout(autoId); idx = 0; bi = 0; answers = quiz.map(x => x.q.answers.map(() => null)); finished = false;
  startedAt = Date.now(); deadline = startedAt + limit * 60000;
  enterQuiz();
}
function enterQuiz() {                 // 새로 시작·이어 풀기 공통: 풀이 화면을 열고 시계를 돌림
  $("resume").hidden = true; saved = null;
  show("quiz"); renderQ(); window.scrollTo(0, 0);
  history.pushState({ quiz: 1 }, "");  // 뒤로가기를 눌러도 이 자리에 머물게
  keepAwake();
  clearInterval(timerId); timerId = setInterval(tick, 500); tick();
}
function tick() {
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  $("timer").textContent = fmt(left);
  $("timer").classList.toggle("low", left <= 60);
  if (left <= 0) finish(true);
}
// 한 문단 그리기: 채운 빈칸은 고른 말, 지금 빈칸은 깜빡이는 칸, 빈 칸은 번호(①②…)
const NUM = "①②③④⑤⑥⑦⑧⑨⑩";
function renderQ() {
  const { q, choices } = quiz[idx], picks = answers[idx];
  $("progress").textContent = `${idx + 1} / ${quiz.length}`;
  $("bar").style.width = `${(idx / quiz.length) * 100}%`;
  let n = 0;
  $("hint").textContent = `${NUM[bi] || bi + 1} 빈칸에 들어갈 말`;
  $("sentence").innerHTML = layout(q.text).replace(/\{\{blank\}\}/g, () => {
    const i = n++, p = picks[i];
    return `<span class="blank${p !== null ? " done" : ""}${i === bi ? " now" : ""}" data-i="${i}">${p !== null ? esc(p) : NUM[i] || i + 1}</span>`;
  });
  const box = $("choices"); box.innerHTML = "";
  choices[bi].forEach(c => {
    const b = document.createElement("button"); b.textContent = c;
    if (c === picks[bi]) b.className = "sel";
    b.addEventListener("click", () => choose(c)); box.appendChild(b);
  });
  $("prev").disabled = idx === 0;
  const last = idx + 1 >= quiz.length;   // '다음'은 안 보임: 마지막 문단의 '제출', 또는 '이전'으로 돌아와 다 채워진 문단에서만 보임
  $("next").hidden = !last && picks.includes(null);
  $("next").disabled = picks.includes(null);
  $("next").textContent = idx + 1 >= quiz.length ? "제출" : "다음";
  saveSession();
}
function choose(c) {                  // 같은 보기를 다시 누르면 취소
  if (finished) return;
  const picks = answers[idx];
  if (picks[bi] === c) picks[bi] = null;
  else {
    picks[bi] = c;
    const nx = picks.findIndex((p, i) => p === null && i > bi), any = picks.indexOf(null);
    bi = nx >= 0 ? nx : any >= 0 ? any : bi;   // 다음 빈 빈칸으로 이동
  }
  renderQ();
  clearTimeout(autoId);                 // 문단의 빈칸을 다 채우면 잠깐 보여 준 뒤 다음 문단으로(마지막 문단은 '제출'을 직접 누름)
  if (!picks.includes(null) && idx + 1 < quiz.length) { $("next").hidden = true; const at = idx; autoId = setTimeout(() => { if (idx === at && !finished) go(1); }, 400); }
}
let autoId = null;
function go(d) {                        // d=1 다음 문단, d=-1 이전 문단
  clearTimeout(autoId);
  idx += d; const e = answers[idx].indexOf(null); bi = e >= 0 ? e : 0;
  renderQ(); window.scrollTo(0, 0);
}
$("sentence").addEventListener("click", e => {   // 빈칸을 누르면 그 빈칸 선택, 채운 빈칸을 다시 누르면 취소
  const s = e.target.closest(".blank"); if (!s || finished) return;
  const i = +s.dataset.i;
  if (i === bi && answers[idx][i] !== null) answers[idx][i] = null; else bi = i;
  renderQ();
});
$("next").addEventListener("click", () => {
  if (idx + 1 >= quiz.length) return finish(false);
  go(1);
});
$("prev").addEventListener("click", () => { if (idx > 0 && !finished) go(-1); });

// 두 빈칸 i, j가 문항 q 내에서 대등한 관계인지 판별 (순서 바뀌어도 정답 처리)
function areEquivBlanks(q, i, j) {
  if (i === j) return false;
  const a1 = q.answers[i], a2 = q.answers[j];
  if (!a1 || !a2) return false;

  // 1. 같은 GROUPS 범주에 속해야 함
  const inSameGroup = GROUPS.some(g =>
    g.words.some(w => norm(w) === norm(a1)) &&
    g.words.some(w => norm(w) === norm(a2)) &&
    (!g.when || g.when.test(q.text))
  );
  if (!inSameGroup) return false;

  // 2. 텍스트 분할 및 위치 검사
  const parts = q.text.split("{{blank}}");
  if (parts.length !== q.answers.length + 1) return false;

  const minI = Math.min(i, j), maxI = Math.max(i, j);
  let mid = "";
  for (let k = minI + 1; k <= maxI; k++) mid += parts[k];
  mid = mid.trim();

  // 3. 줄바꿈, 탭, 콜론(:), 괄호 설명 ( ), 개별 조건이 있으면 개별 정의이므로 대등하지 않음
  if (/[\n\t:]/.test(mid)) return false;
  if (/\(.*?\)/.test(mid)) return false;
  if (/[은는이가]\s*결합한 것은/.test(mid)) return false;

  // 따옴표/기호 제거한 clean 문자열
  const midClean = mid.replace(/['"‘’“”,·/]/g, "").trim();

  // 4. 대등 나열 패턴
  // - 접속 조사 나열 (예: "와", "과", "및", "또는", 따옴표 붙은 "와 '")
  if (/^(와|과|및|또는)$/.test(midClean)) return true;
  // - 쉼표/슬래시/가운뎃점 나열 (예: ", ", ", 수식언, ", " / ")
  if (/^([,·/]\s*([가-힣]+[,·/]\s*)*)$/.test(mid)) return true;
  if (/^(와|과|및|또는|,|\/|·)\s*$/.test(mid)) return true;
  if (/^[가-힣]+(와|과|및|,|\/)\s*$/.test(mid)) return true;
  // - 문장 끝부분에 대등 나열 구문이 있고 mid가 단순 조사/구분자인 경우
  const after = parts[maxI + 1] || "";
  if (/등에도 붙는다|등으로|로 나뉜다|로 분류|포함되어 있으므로|쓰일 때도 있다|모두 쓰이므로/.test(after)) {
    if (!/[은는이가를]\s+[가-힣]+[은는]/.test(mid) && mid.length <= 15) return true;
  }

  return false;
}

// 문항 q에 대해 학생의 답변 picks 채점 (대등 빈칸은 순서 바뀌어도 유연하게 정답 처리)
function gradeQuestion(q, picks) {
  const n = q.answers.length;
  const ok = new Array(n).fill(false);

  // 대등 클러스터 생성 (Union-Find)
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (x, y) => { parent[find(x)] = find(y); };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (areEquivBlanks(q, i, j)) union(i, j);
    }
  }

  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  }

  // 클러스터별 채점
  clusters.forEach(indices => {
    const unpickedAnswers = [];
    const unsolvedIndices = [];
    indices.forEach(idx => {
      const p = picks[idx], a = q.answers[idx];
      if (p !== null && norm(p) === norm(a)) {
        ok[idx] = true;
      } else {
        unpickedAnswers.push(a);
        unsolvedIndices.push(idx);
      }
    });

    unsolvedIndices.forEach(idx => {
      const p = picks[idx];
      if (p !== null) {
        const matchIdx = unpickedAnswers.findIndex(a => norm(a) === norm(p));
        if (matchIdx >= 0) {
          ok[idx] = true;
          unpickedAnswers.splice(matchIdx, 1);
        }
      }
    });
  });

  return ok;
}

// ===== 결과 =====
function finish(timedOut) {
  if (finished) return; finished = true; clearInterval(timerId);
  clearSession(); releaseAwake();
  // 점수는 빈칸 하나가 1점
  let right = 0, solved = 0, total = 0;
  const wrong = [];
  quiz.forEach(({ q }, i) => {
    const picks = answers[i];
    total += q.answers.length; solved += picks.filter(p => p !== null).length;
    const ok = gradeQuestion(q, picks);
    right += ok.filter(Boolean).length;
    if (picks.some((p, b) => p !== null && !ok[b])) wrong.push({ q, ok, picks });
  });
  const sec = Math.round((Date.now() - startedAt) / 1000);
  const pct = total ? Math.round((right / total) * 100) : 0, passed = pct >= PASS;
  $("score").innerHTML = `<div>${pct}<small>점</small></div>`;
  $("ring").style.setProperty("--p", pct);
  $("resultImg").src = passed ? IMG.pass : IMG.fail;
  $("verdict").textContent = passed ? "통과! 🎉" : "아쉽다… 다시 도전!";
  $("verdict").className = passed ? "pass" : "fail";
  $("reveal").classList.toggle("is-fail", !passed);
  $("wrongTitle").hidden = !wrong.length;
  $("sub").textContent = `맞힌 빈칸 ${right} / ${total} · 통과 ${PASS}점 · ${fmt(sec)}` + (timedOut ? ` · 시간 종료 (미응시 ${total - solved})` : "");
  $("wrongList").innerHTML = wrong.length
    ? wrong.map(({ q, ok, picks }) => {
        let n = 0;
        const t = layout(q.text).replace(/\{\{blank\}\}/g, () => {
          const b = n++, isOk = ok[b], pick = picks[b], ans = q.answers[b];
          if (isOk) {
            return `<b class="good">${esc(ans)}</b>`;
          } else {
            return `<span class="wrong-box"><b class="my-pick">${esc(pick || "미응시")}</b><span class="arrow">➔</span><b class="ans">${esc(ans)}</b></span>`;
          }
        });
        return `<div class="card passage">${t}</div>`;
      }).join("")
    : '<p class="note">틀린 문제가 없습니다.</p>';
  show("result"); window.scrollTo(0, 0);
  $("suspense").hidden = false; $("reveal").hidden = true;           // 2초 두근두근 후 공개
  setTimeout(() => { $("suspense").hidden = true; $("reveal").hidden = false; }, 2000);
  const levelText = level === "basic" ? "기본형" : `심화형(${count}개)`;
  saveWrongNotes(wrong, levelText);
  sendResult({
    time: stamp(new Date()), name: $("name").value.trim(), level: levelText,
    total, score: right, solved, wrong: wrong.map(w => w.q.id).join(","), seconds: sec, timedOut: timedOut ? "Y" : "N"
  });
}

// ===== 스프레드시트 전송 (실패하면 기기에 보관했다가 다음 접속 때 다시 보냄) =====
const post = r => fetch(SHEET_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(r) });
const pending = () => { try { return JSON.parse(localStorage.getItem("pending") || "[]"); } catch (e) { return []; } };
const savePending = a => { try { localStorage.setItem("pending", JSON.stringify(a)); } catch (e) {} };
async function sendResult(r) {
  if (!SHEET_URL) return;
  try { await post(r); } catch (e) { savePending([...pending(), r]); }
}
async function retryPending() {
  if (!SHEET_URL) return;
  const keep = [];
  for (const r of pending()) { try { await post(r); } catch (e) { keep.push(r); } }
  savePending(keep);
}

// ===== 오답노트 (로컬 스토리지 보관) =====
function getWrongNotes() {
  try { return JSON.parse(localStorage.getItem("wrongNotes") || "[]"); } catch (e) { return []; }
}
function saveWrongNotes(wrongItems, levelText) {
  if (!wrongItems || !wrongItems.length) return;
  const current = getWrongNotes();
  const now = stamp(new Date());
  wrongItems.forEach(({ q, ok, picks }) => {
    const idx = current.findIndex(x => x.id === q.id);
    const item = {
      id: q.id, text: q.text, answers: q.answers,
      ok, picks, level: levelText, time: now
    };
    if (idx >= 0) current[idx] = item;
    else current.unshift(item);
  });
  try { localStorage.setItem("wrongNotes", JSON.stringify(current)); } catch (e) {}
  updateNotesBadge();
}
function updateNotesBadge() {
  const cnt = getWrongNotes().length;
  const el = $("notesBadge"); if (el) el.textContent = cnt;
}
function renderNotes() {
  const notes = getWrongNotes();
  const box = $("notesList");
  if (!notes.length) {
    box.innerHTML = '<div class="card passage"><p class="note" style="padding: 24px 0;">아직 저장된 오답이 없습니다.<br>문제를 풀고 틀린 문항이 생기면 여기에 자동으로 모입니다!</p></div>';
    return;
  }
  box.innerHTML = notes.map((item, i) => {
    let n = 0;
    const t = layout(item.text).replace(/\{\{blank\}\}/g, () => {
      const b = n++, isOk = item.ok[b], pick = item.picks[b], ans = item.answers[b];
      if (isOk) {
        return `<b class="good">${esc(ans)}</b>`;
      } else {
        return `<span class="wrong-box"><b class="my-pick">${esc(pick || "미응시")}</b><span class="arrow">➔</span><b class="ans">${esc(ans)}</b></span>`;
      }
    });
    return `
      <div class="card passage" style="margin-bottom: 20px;">
        <div class="notes-meta">
          <span>#${i + 1} [${esc(item.level)}]</span>
          <span>${esc(item.time)}</span>
        </div>
        ${t}
      </div>`;
  }).join("");
}

// 오답노트 화면 이벤트
$("btnNotes").addEventListener("click", () => { renderNotes(); show("notes"); window.scrollTo(0, 0); });
const resNotesBtn = $("btnResultNotes");
if (resNotesBtn) resNotesBtn.addEventListener("click", () => { renderNotes(); show("notes"); window.scrollTo(0, 0); });
$("btnNotesBack").addEventListener("click", () => { show("start"); updateNotesBadge(); window.scrollTo(0, 0); });
$("btnClearNotes").addEventListener("click", () => {
  if (confirm("오답노트를 모두 비우시겠습니까?")) {
    try { localStorage.removeItem("wrongNotes"); } catch (e) {}
    renderNotes(); updateNotesBadge();
  }
});

// ===== 풀던 문제 보관 (탭이 닫히거나 새로고침돼도 이어 풀기) =====
// 마감 시각을 그대로 보관하므로 나가 있던 시간도 제한시간에서 빠짐
const SKEY = "session";
function saveSession() {
  if (finished || !quiz.length) return;
  try {
    localStorage.setItem(SKEY, JSON.stringify({
      level, count, name: $("name").value.trim(), startedAt, deadline, idx, bi, answers,
      quiz: quiz.map(x => ({ id: x.q.id, choices: x.choices }))
    }));
  } catch (e) {}
}
function clearSession() { try { localStorage.removeItem(SKEY); } catch (e) {} }
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || "null");
    const pool = s && DATA && DATA[s.level];
    if (!pool) return null;
    const byId = new Map(pool.map(q => [q.id, q]));
    const qz = s.quiz.map(x => ({ q: byId.get(x.id), choices: x.choices }));
    if (!qz.length || qz.some(x => !x.q || x.choices.length !== x.q.answers.length)) return null;   // 문항이 바뀌었으면 버림
    return { ...s, quiz: qz };
  } catch (e) { return null; }
}
let saved = null;
function checkResume() {
  saved = loadSession();
  if (!saved) { clearSession(); $("resume").hidden = true; return; }
  const left = Math.max(0, Math.ceil((saved.deadline - Date.now()) / 1000));
  const done = saved.answers.flat().filter(p => p !== null).length, all = saved.answers.flat().length;
  const lv = saved.level === "basic" ? "기본형" : `심화형(${saved.count}개)`;
  $("resumeInfo").innerHTML = `<b>${esc(saved.name || "이름 없음")}</b> · ${lv} 풀던 문제가 있어요.<br>` +
    (left > 0 ? `빈칸 ${done} / ${all} 완료 · 남은 시간 ${fmt(left)}` : `제한시간이 끝났어요. 푼 데까지 채점합니다.`);
  $("btnResume").textContent = left > 0 ? "이어서 풀기" : "결과 보기";
  $("resume").hidden = false;
}
$("btnResume").addEventListener("click", () => {
  const s = saved; if (!s) return;
  level = s.level; count = s.count; $("name").value = s.name;
  [...$("levelGroup").children].forEach(x => x.classList.toggle("on", x.dataset.level === level));
  [...$("countGroup").children].forEach(x => x.classList.toggle("on", +x.dataset.count === count));
  refreshStart();
  quiz = s.quiz; answers = s.answers; idx = Math.min(s.idx, quiz.length - 1); bi = s.bi;
  startedAt = s.startedAt; deadline = s.deadline; finished = false; clearTimeout(autoId);
  $("resume").hidden = true; saved = null;
  enterQuiz();                          // 시간이 이미 끝났으면 tick()이 바로 제출
});
$("btnDiscard").addEventListener("click", () => {
  if (!confirm("풀던 문제를 버리고 처음부터 시작할까요?")) return;
  clearSession(); saved = null; $("resume").hidden = true;
});
const solving = () => !$("quiz").hidden && !finished;
window.addEventListener("popstate", () => { if (solving()) history.pushState({ quiz: 1 }, ""); });   // 뒤로가기 무시
window.addEventListener("beforeunload", e => { if (solving()) { saveSession(); e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("pagehide", saveSession);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveSession();
  else if (solving()) keepAwake();      // 화면을 다시 켜면 꺼짐 방지도 다시 켬
});

// 푸는 동안 화면이 저절로 꺼지지 않게(지원하는 브라우저만)
let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {}
}
function releaseAwake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }

updateNotesBadge();
load();
