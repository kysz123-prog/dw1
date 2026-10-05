// ===== 설정 (여기만 고치면 됨) =====
const SHEET_URL = "";                                    // 구글 앱스 스크립트 웹앱 주소 (비워 두면 전송 안 함)
const MINUTES = { 50: 17, 100: 30, 150: 50 };           // 문제 수 → 제한 시간(분)
const PASS = 80;                                         // 통과 점수(100점 만점)
const IMG = { pass: "img/pass.webp", fail: "img/fail.webp" };
Object.values(IMG).forEach(s => { new Image().src = s; });   // 결과 사진 미리 불러오기

// 불러오기 실패 때 쓰는 테스트용 샘플
const SAMPLE = { items: [
  { id: "s1", hang: "35", type: "pick", stem: "내일 선생님을 {{blank}}.", choices: ["봬요", "뵈요"], answer: 0, explain: "‘뵈-’ + ‘-어요’ → ‘봬요’(제35항 [붙임 2]).", source: ["자습서"] }
] };

// ===== 상태 =====
let DATA = null;
let count = null, quiz = [], idx = 0, picks = [], startedAt = 0, timerId = null, deadline = 0, finished = false;
const $ = id => document.getElementById(id);
// 기기 저장 키: 같은 주소(kysz123-prog.github.io)의 다른 웹앱과 섞이지 않게 앱 이름을 붙임
const KEY = { session: "dw1:session", notes: "dw1:wrongNotes", pending: "dw1:pending" };

// ===== 유틸 =====
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const show = id => ["start", "quiz", "result", "notes"].forEach(v => $(v).hidden = v !== id);
const p2 = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;  // 시트가 날짜·시각으로 알아보는 형식
const fmt = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const NUM = "①②③④⑤⑥⑦⑧⑨⑩";
const ask = q => q.type === "pick" ? "<보기>를 참고하여 바른 표기를 고르세요." : q.stem;
// <보기>: 그 항(+also 항)의 조문 전체(예시 제외). 조문은 questions.json의 rules에 항마다 한 번만 적음
function bogi(q) {
  const text = [q.hang, ...(q.also || [])].map(h => DATA && DATA.rules && DATA.rules[h]).filter(Boolean).join("\n");
  if (!text) return "";
  const lines = Core.ruleLines(text).map(l =>
    l.kind === "head" ? `<p class="r-head">${esc(l.text)}</p>`
    : l.kind === "note" ? `<p class="r-body"><b>${esc(l.label)}</b> ${esc(l.text)}</p>`
    : `<p class="r-body">${esc(l.text)}</p>`).join("");
  return `<div class="bogi"><span class="bogi-t">&lt;보기&gt;</span>${lines}</div>`;
}
// 문제 글: pick은 {{blank}} 자리에 밑줄 칸(고른 말이 있으면 그 말), find는 발문만
function stemHTML(q, fill) {
  if (q.type !== "pick") return "";
  return esc(q.stem).replace("{{blank}}", `<span class="blank${fill != null ? " done" : " now"}">${fill != null ? esc(fill) : "　　"}</span>`);
}

// ===== 데이터 불러오기 =====
let failMsg = "";
async function load() {
  if (window.QUESTIONS) DATA = window.QUESTIONS;      // 더블클릭으로 열어도 동작
  else {
    try {
      const r = await fetch("questions.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      DATA = await r.json();
    } catch (e) { DATA = SAMPLE; failMsg = "문제 파일을 못 불러와 샘플로 실행 중입니다. "; }
  }
  refreshStart();
  if (DATA !== SAMPLE) checkResume();   // 샘플로 돌 때는 풀던 기록을 건드리지 않음
  retryPending();
}

// ===== 시작 화면 =====
function refreshStart() {
  const n = DATA ? DATA.items.length : 0;
  $("info").textContent = failMsg + (count ? `${Math.min(count, n)}문제 · 제한 ${MINUTES[count]}분 · 통과 ${PASS}점` : "문제 수를 골라 주세요.");
  $("go").disabled = !(n && count && $("name").value.trim());
}
function setCount(c) { count = c; [...$("countGroup").children].forEach(b => b.classList.toggle("on", +b.dataset.count === c)); refreshStart(); }
$("countGroup").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setCount(+b.dataset.count); });
$("name").addEventListener("input", refreshStart);
$("go").addEventListener("click", startQuiz);
$("again").addEventListener("click", () => { show("start"); });

// ===== 풀이 =====
function startQuiz() {
  quiz = Core.buildQuiz(Core.pickN(DATA.items, count)); picks = quiz.map(() => null);   // 항별 비율대로 count문제
  clearTimeout(autoId); idx = 0; finished = false;
  startedAt = Date.now(); deadline = startedAt + MINUTES[count] * 60000;
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
// 한 문제 그리기: 고른 보기만 표시(정오답은 결과 화면에서)
function renderQ() {
  const q = quiz[idx], p = picks[idx];
  $("progress").textContent = `${idx + 1} / ${quiz.length}`;
  $("bar").style.width = `${(idx / quiz.length) * 100}%`;
  $("hint").textContent = `제${q.hang}항`;
  $("sentence").innerHTML = `<p class="ask">${esc(ask(q))}</p>` + bogi(q) + (q.type === "pick" ? `<p class="stem">${stemHTML(q, p != null ? q.choices[p] : null)}</p>` : "");
  const box = $("choices"); box.innerHTML = "";
  box.className = q.type === "find" ? "long" : "";
  q.choices.forEach((c, k) => {
    const b = document.createElement("button");
    b.textContent = `${NUM[k]} ${c}`;
    if (k === p) b.className = "sel";
    b.addEventListener("click", () => choose(k)); box.appendChild(b);
  });
  $("prev").disabled = idx === 0;
  const last = idx + 1 >= quiz.length;   // '다음'은 안 보임: 마지막 문제의 '제출', 또는 '이전'으로 돌아온 푼 문제에서만 보임
  $("next").hidden = !last && p == null;
  $("next").disabled = last ? false : p == null;
  $("next").textContent = last ? "제출" : "다음";
  saveSession();
}
function choose(k) {                  // 같은 보기를 다시 누르면 취소
  if (finished) return;
  picks[idx] = picks[idx] === k ? null : k;
  renderQ();
  clearTimeout(autoId);                 // 고르면 잠깐 보여 준 뒤 다음 문제로(마지막 문제는 '제출'을 직접 누름)
  if (picks[idx] != null && idx + 1 < quiz.length) { $("next").hidden = true; const at = idx; autoId = setTimeout(() => { if (idx === at && !finished) go(1); }, 400); }
}
let autoId = null;
function go(d) { clearTimeout(autoId); idx += d; renderQ(); window.scrollTo(0, 0); }
$("next").addEventListener("click", () => {
  if (idx + 1 < quiz.length) return go(1);
  const empty = picks.filter(p => p == null).length;
  if (empty && !confirm(`안 푼 문제가 ${empty}개 있어요. 그래도 제출할까요?`)) return;
  finish(false);
});
$("prev").addEventListener("click", () => { if (idx > 0 && !finished) go(-1); });

// ===== 채점·결과 =====
// 틀린 문제 카드: 문제, 내 답 → 정답, 해설, 출처 (결과 화면과 오답노트가 같이 씀)
function wrongCard(q, pick, meta) {
  const mine = pick != null ? `${NUM[pick]} ${q.choices[pick]}` : "미응시";
  const ans = `${NUM[q.answer]} ${q.choices[q.answer]}`;
  return `<div class="card passage">
    ${meta ? `<div class="notes-meta">${meta}</div>` : ""}
    <p class="ask"><span class="tag">제${esc(q.hang)}항</span> ${esc(ask(q))}</p>
    ${bogi(q)}
    ${q.type === "pick" ? `<p class="stem">${stemHTML(q, q.choices[q.answer])}</p>` : ""}
    <ol class="opts">${q.choices.map((c, k) => `<li class="${k === q.answer ? "ans" : k === pick ? "my-pick" : ""}">${NUM[k]} ${esc(c)}</li>`).join("")}</ol>
    <div class="wrong-box"><b class="my-pick">${esc(mine)}</b><span class="arrow">➔</span><b class="ans">${esc(ans)}</b></div>
    <p class="explain">${esc(q.explain)}</p>
    <p class="src">출처: ${q.source.map(esc).join(" · ")}</p>
  </div>`;
}
function finish(timedOut) {
  if (finished) return; finished = true; clearInterval(timerId); clearTimeout(autoId);
  clearSession(); releaseAwake();
  const r = Core.grade(quiz, picks);
  const solved = picks.filter(p => p != null).length;
  const sec = Math.round((Date.now() - startedAt) / 1000), passed = r.score >= PASS;
  $("score").innerHTML = `<div>${r.score}<small>점</small></div>`;
  $("ring").style.setProperty("--p", r.score);
  $("resultImg").src = passed ? IMG.pass : IMG.fail;
  $("verdict").textContent = passed ? "통과! 🎉" : "아쉽다… 다시 도전!";
  $("verdict").className = passed ? "pass" : "fail";
  $("reveal").classList.toggle("is-fail", !passed);
  $("sub").textContent = `맞힌 문제 ${r.correct} / ${r.total} · 통과 ${PASS}점 · ${fmt(sec)}` + (timedOut ? ` · 시간 종료 (미응시 ${r.total - solved})` : "");
  $("hangTable").innerHTML = `<table class="hang"><tr><th>조항</th><th>맞힌 수</th></tr>` +
    r.byHang.map(h => `<tr class="${h.correct < h.total ? "miss" : ""}"><td>제${esc(h.hang)}항</td><td>${h.correct} / ${h.total}</td></tr>`).join("") + "</table>";
  $("wrongTitle").hidden = !r.wrong.length;
  $("wrongList").innerHTML = r.wrong.length ? r.wrong.map(w => wrongCard(w.q, w.pick)).join("") : '<p class="note">틀린 문제가 없습니다.</p>';
  show("result"); window.scrollTo(0, 0);
  $("suspense").hidden = false; $("reveal").hidden = true;           // 2초 두근두근 후 공개
  setTimeout(() => { $("suspense").hidden = true; $("reveal").hidden = false; }, 2000);
  saveWrongNotes(r.wrong);
  sendResult({
    time: stamp(new Date()), name: $("name").value.trim(), level: `${count}문제`,
    total: r.total, score: r.score, solved, wrong: r.wrong.map(w => w.q.id).join(","), seconds: sec, timedOut: timedOut ? "Y" : "N"
  });
}

// ===== 스프레드시트 전송 (실패하면 기기에 보관했다가 다음 접속 때 다시 보냄) =====
const post = r => fetch(SHEET_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(r) });
const pending = () => { try { return JSON.parse(localStorage.getItem(KEY.pending) || "[]"); } catch (e) { return []; } };
const savePending = a => { try { localStorage.setItem(KEY.pending, JSON.stringify(a)); } catch (e) {} };
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

// ===== 오답노트 (로컬 스토리지 보관, 같은 문제는 최근 것만) =====
function getWrongNotes() {
  try { return JSON.parse(localStorage.getItem(KEY.notes) || "[]").filter(x => x && x.q && x.q.id && Array.isArray(x.q.choices)); } catch (e) { return []; }
}
function saveWrongNotes(wrong) {
  if (!wrong.length) return;
  const now = stamp(new Date());
  const current = getWrongNotes().filter(x => !wrong.some(w => w.q.id === x.q.id));
  try { localStorage.setItem(KEY.notes, JSON.stringify([...wrong.map(w => ({ q: w.q, pick: w.pick, time: now })), ...current])); } catch (e) {}
  updateNotesBadge();
}
function updateNotesBadge() { const el = $("notesBadge"); if (el) el.textContent = getWrongNotes().length; }
function renderNotes() {
  const notes = getWrongNotes().filter(x => x && x.q && Array.isArray(x.q.choices));
  $("notesList").innerHTML = notes.length
    ? notes.map((x, i) => wrongCard(x.q, x.pick, `<span>#${i + 1}</span><span>${esc(x.time)}</span>`)).join("")
    : '<div class="card passage"><p class="note" style="padding: 24px 0;">아직 저장된 오답이 없습니다.<br>문제를 풀고 틀린 문제가 생기면 여기에 자동으로 모입니다!</p></div>';
}
const openNotes = () => { renderNotes(); show("notes"); window.scrollTo(0, 0); };
$("btnNotes").addEventListener("click", openNotes);
$("btnResultNotes").addEventListener("click", openNotes);
$("btnNotesBack").addEventListener("click", () => { show("start"); updateNotesBadge(); window.scrollTo(0, 0); });
$("btnClearNotes").addEventListener("click", () => {
  if (confirm("오답노트를 모두 비우시겠습니까?")) {
    try { localStorage.removeItem(KEY.notes); } catch (e) {}
    renderNotes(); updateNotesBadge();
  }
});

// ===== 풀던 문제 보관 (탭이 닫히거나 새로고침돼도 이어 풀기) =====
// 마감 시각을 그대로 보관하므로 나가 있던 시간도 제한시간에서 빠짐
function saveSession() {
  if (finished || !quiz.length) return;
  try { localStorage.setItem(KEY.session, JSON.stringify({ name: $("name").value.trim(), count, startedAt, deadline, idx, ...Core.snapshot(quiz, picks) })); } catch (e) {}
}
function clearSession() { try { localStorage.removeItem(KEY.session); } catch (e) {} }
function loadSession() {               // 문제가 바뀌었거나 깨졌으면 null(버림)
  try {
    const s = JSON.parse(localStorage.getItem(KEY.session) || "null");
    const back = s && DATA && Core.restore(s, DATA.items);
    return back && back.quiz.length ? { ...s, ...back } : null;
  } catch (e) { return null; }
}
let saved = null;
function checkResume() {
  saved = loadSession();
  if (!saved) { clearSession(); $("resume").hidden = true; return; }
  const left = Math.max(0, Math.ceil((saved.deadline - Date.now()) / 1000));
  const done = saved.picks.filter(p => p != null).length;
  $("resumeInfo").innerHTML = `<b>${esc(saved.name || "이름 없음")}</b> 풀던 문제가 있어요.<br>` +
    (left > 0 ? `${done} / ${saved.quiz.length}문제 완료 · 남은 시간 ${fmt(left)}` : `제한시간이 끝났어요. 푼 데까지 채점합니다.`);
  $("btnResume").textContent = left > 0 ? "이어서 풀기" : "결과 보기";
  $("resume").hidden = false;
}
$("btnResume").addEventListener("click", () => {
  const s = saved; if (!s) return;
  $("name").value = s.name; setCount(s.count || null);
  quiz = s.quiz; picks = s.picks; idx = Math.min(Math.max(0, s.idx | 0), quiz.length - 1);
  startedAt = s.startedAt; deadline = s.deadline; finished = false; clearTimeout(autoId);
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
