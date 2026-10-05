// 출제·채점·항별 집계·세션 저장 형식 (화면 코드 없음, node로 테스트: node --test test/*.test.js)
(function () {
  function shuffle(a, rand) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // order = 원래 보기 번호를 섞인 순서대로 늘어놓은 것
  function arrange(item, order) {
    return { ...item, choices: order.map(k => item.choices[k]), answer: order.indexOf(item.answer), order };
  }

  // 문제 순서와 각 문제의 보기 순서를 섞는다. 정답 번호는 섞인 순서 기준
  function buildQuiz(items, rand = Math.random) {
    return shuffle(items, rand).map(it => arrange(it, shuffle(it.choices.map((_, k) => k), rand)));
  }

  // 전체에서 n문제 뽑기: 항별 비율을 유지(최대 나머지 방식), 같은 항 안에서는 무작위
  function pickN(items, n, rand = Math.random) {
    if (n >= items.length) return items.slice();
    const groups = {};
    for (const it of items) (groups[it.hang] = groups[it.hang] || []).push(it);
    const hs = shuffle(Object.keys(groups), rand);        // 나머지가 같을 때 어느 항이 먼저일지 무작위
    const share = hs.map(h => { const x = n * groups[h].length / items.length; return { h, k: Math.floor(x), r: x - Math.floor(x) }; });
    let left = n - share.reduce((s, x) => s + x.k, 0);
    for (const x of share.slice().sort((a, b) => b.r - a.r)) { if (left <= 0) break; x.k++; left--; }
    return share.flatMap(x => shuffle(groups[x.h], rand).slice(0, x.k));
  }

  // picks[i] = i번째 문제에서 고른 보기 번호(안 풀었으면 null). 안 푼 문제는 오답
  function grade(quiz, picks) {
    const wrong = [], hangs = {};
    let correct = 0;
    quiz.forEach((q, i) => {
      const pick = picks[i] ?? null, ok = pick === q.answer;
      const h = hangs[q.hang] || (hangs[q.hang] = { hang: q.hang, correct: 0, total: 0 });
      h.total++;
      if (ok) { correct++; h.correct++; } else wrong.push({ q, pick });
    });
    const total = quiz.length;
    return {
      score: total ? Math.round(correct / total * 100) : 0, correct, total, wrong,
      byHang: Object.values(hangs).sort((a, b) => Number(a.hang) - Number(b.hang)),
    };
  }

  const snapshot = (quiz, picks) => ({ ids: quiz.map(q => q.id), orders: quiz.map(q => q.order), picks: picks.slice() });

  // 저장된 문제가 지금 데이터에 하나라도 없거나(재배포 등) 형식이 깨졌으면 null → 새로 시작
  function restore(saved, items) {
    if (!saved || !Array.isArray(saved.ids) || !Array.isArray(saved.orders) || !Array.isArray(saved.picks)) return null;
    const byId = new Map(items.map(it => [it.id, it]));
    const quiz = [];
    for (let i = 0; i < saved.ids.length; i++) {
      const it = byId.get(saved.ids[i]), order = saved.orders[i];
      if (!it || !Array.isArray(order) || order.length !== it.choices.length) return null;
      quiz.push(arrange(it, order));
    }
    return { quiz, picks: saved.picks.slice() };
  }

  // 조문 글 → 줄 목록: '제N항'은 따로 한 줄(head), [붙임 …]은 이름표(note), 나머지는 본문(body)
  function ruleLines(text) {
    const out = [];
    for (const line of text.split("\n")) {
      const h = line.match(/^(제\d+항)\s*(.*)$/), n = line.match(/^(\[붙임[^\]]*\])\s*(.*)$/);
      if (h) { out.push({ kind: "head", text: h[1] }); if (h[2]) out.push({ kind: "body", text: h[2] }); }
      else if (n) out.push({ kind: "note", label: n[1], text: n[2] });
      else out.push({ kind: "body", text: line });
    }
    return out;
  }

  const Core = { buildQuiz, pickN, grade, snapshot, restore, ruleLines };
  if (typeof module !== "undefined") module.exports = Core; else window.Core = Core;
})();
