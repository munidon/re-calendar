// ===== 공시법 기출 =====
// 「공시법 기출 문제풀이 과정 보충자료」 문항을 지적법(공간정보법) / 등기법(부동산등기법)으로
// 나눠 한 문제씩 푼다. 시간 제한 없이 답을 고르면 바로 채점하고, 진행 상황은 이 기기에
// 저장돼 이어 풀 수 있다. 여러 자료에 다시 실린 문항은 빌드 때 한 번만 남겼다.
// 문항 텍스트·정답은 scripts/build_gongsi_assets.py 로 PDF에서 뽑았다(그림 2개만 이미지).

import { GONGSI_QUESTIONS } from './assets/gongsi/gongsi-bank.js';

const GONGSI_PROGRESS_KEY = 'gongsiProgress';

const SUBJECTS = [
  { key: 'jijeok', title: '지적법', desc: '공간정보의 구축 및 관리 등에 관한 법률' },
  { key: 'deunggi', title: '등기법', desc: '부동산등기법' }
];

const CIRCLED = ['', '①', '②', '③', '④', '⑤'];

let progress = loadProgress();
let activeSubject = null;

// ───────────────────────── 저장 ─────────────────────────

function emptyProgress() {
  return { answers: {}, index: 0, queue: null };
}

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(GONGSI_PROGRESS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(GONGSI_PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {
    /* 저장 실패가 풀이를 막지는 않는다 */
  }
}

function subjectProgress(key) {
  if (!progress[key]) progress[key] = emptyProgress();
  return progress[key];
}

// ───────────────────────── 계산 ─────────────────────────

function subjectOf(key) {
  return SUBJECTS.find(subject => subject.key === key);
}

function allQuestions(key) {
  return GONGSI_QUESTIONS.filter(q => q.subject === key);
}

// 지금 푸는 목록: 오답 다시 풀기 중이면 그 문항들만.
function currentList(key) {
  const state = subjectProgress(key);
  const all = allQuestions(key);
  if (!state.queue) return all;
  const queued = new Set(state.queue);
  return all.filter(q => queued.has(q.id));
}

function tally(questions, answers) {
  let answered = 0;
  let correct = 0;
  questions.forEach(q => {
    if (answers[q.id] == null) return;
    answered += 1;
    if (answers[q.id] === q.answer) correct += 1;
  });
  return { answered, correct, wrong: answered - correct, total: questions.length };
}

function sourceLabel(q) {
  return `기출문제풀이 ${q.part} · ${q.number}번${q.round ? ` · ${q.round}` : ''}`;
}

// ───────────────────────── 렌더 ─────────────────────────

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 발문과 선택지 사이의 자료: 보기 상자, 표(토지대장), 그림(지적도면 등)
function renderMaterial(q) {
  let html = '';
  if (q.box) {
    html += `<div class="gongsi-box">${q.box.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div>`;
  }
  if (q.table) {
    const rows = q.table.rows.map(row => `<tr>${row.map(cell => {
      const c = typeof cell === 'string' ? { t: cell } : cell;
      const tag = c.head ? 'th' : 'td';
      const span = c.span ? ` colspan="${c.span}"` : '';
      return `<${tag}${span}>${escapeHtml(c.t).replace(/\n/g, '<br>')}</${tag}>`;
    }).join('')}</tr>`).join('');
    html += `
      <div class="gongsi-table-wrap">
        <table class="gongsi-table">
          ${q.table.title ? `<caption>${escapeHtml(q.table.title)}</caption>` : ''}
          ${rows}
        </table>
      </div>`;
  }
  if (q.figure) {
    html += `<img class="gongsi-figure" src="${q.figure}" alt="문제 그림">`;
  }
  return html;
}

function renderGongsi() {
  const container = document.getElementById('gongsiPractice');
  if (!container) return;
  if (activeSubject) renderSolver(container);
  else renderIntro(container);
}

function renderIntro(container) {
  const cards = SUBJECTS.map(subject => {
    const state = subjectProgress(subject.key);
    const list = currentList(subject.key);
    const all = allQuestions(subject.key);
    const { answered, correct } = tally(list, state.answers);
    const percent = list.length ? Math.round((answered / list.length) * 100) : 0;
    const started = answered > 0 || state.queue;
    const scope = state.queue ? `오답 ${list.length}문항` : `${all.length}문항`;
    return `
      <div class="gongsi-card">
        <div class="gongsi-card-head">
          <span class="gongsi-card-title">${subject.title}</span>
          <span class="gongsi-card-count">${scope}</span>
        </div>
        <div class="gongsi-card-desc">${subject.desc}</div>
        <div class="quiz-progress-bar gongsi-card-bar"><i style="width:${percent}%"></i></div>
        <div class="gongsi-card-meta">
          ${started ? `${answered} / ${list.length} 풀이 · 정답 ${correct}` : '아직 풀지 않음'}
        </div>
        <div class="gongsi-card-actions">
          ${started ? `<button class="exam-small-btn" data-reset="${subject.key}">처음부터</button>` : ''}
          <button class="btn btn-confirm" data-start="${subject.key}">${started ? '이어 풀기' : '풀기 시작'}</button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="quiz-intro">
      <p class="quiz-lead">공시법 기출 <strong>${GONGSI_QUESTIONS.length}문항</strong>을 지적법 · 등기법으로 나눠 한 문제씩 풉니다.</p>
      <ul class="quiz-rules">
        <li>시간 제한은 없습니다. 답을 고르면 바로 채점되고, 해설이 있는 문항은 해설도 함께 보입니다.</li>
        <li>풀던 위치와 답은 이 기기에 저장되어 언제든 <strong>이어 풀기</strong> 할 수 있습니다.</li>
        <li>여러 회차 자료에 다시 실린 문항은 한 번만 나옵니다.</li>
      </ul>
      <div class="gongsi-cards">${cards}</div>
    </div>
  `;

  container.querySelectorAll('[data-start]').forEach(btn => {
    btn.addEventListener('click', () => openSubject(btn.dataset.start));
  });
  container.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const subject = subjectOf(btn.dataset.reset);
      if (!confirm(`${subject.title} 풀이 기록을 지우고 처음부터 시작할까요?`)) return;
      progress[subject.key] = emptyProgress();
      saveProgress();
      openSubject(subject.key);
    });
  });
}

function renderSolver(container) {
  const subject = subjectOf(activeSubject);
  const state = subjectProgress(activeSubject);
  const list = currentList(activeSubject);
  if (!list.length) {
    state.queue = null;
    saveProgress();
    activeSubject = null;
    renderGongsi();
    return;
  }
  state.index = Math.min(Math.max(state.index || 0, 0), list.length - 1);

  const q = list[state.index];
  const chosen = state.answers[q.id];
  const graded = chosen != null;
  const isCorrect = graded && chosen === q.answer;
  const stats = tally(list, state.answers);
  const finished = stats.answered === stats.total;

  const options = q.options.map((text, i) => {
    const value = i + 1;
    const classes = ['gongsi-option'];
    if (graded && value === q.answer) classes.push('is-answer');
    if (graded && value === chosen && !isCorrect) classes.push('is-wrong');
    return `
      <li>
        <button class="${classes.join(' ')}" data-answer="${value}" ${graded ? 'disabled' : ''}>
          <span class="gongsi-option-mark">${CIRCLED[value]}</span>
          <span class="gongsi-option-text">${escapeHtml(text)}</span>
        </button>
      </li>`;
  }).join('');

  const feedback = graded
    ? `
      <div class="answer-feedback ${isCorrect ? 'correct' : 'wrong'}">
        <span class="answer-feedback-badge">${isCorrect ? '정답' : '오답'}</span>
        <span class="answer-feedback-detail">내 답 ${CIRCLED[chosen]} · 정답 ${CIRCLED[q.answer]}</span>
      </div>
      ${q.explain ? `
        <div class="gongsi-explain">
          <div class="gongsi-explain-label">해설</div>
          ${q.explain.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
        </div>` : ''}`
    : '<div class="answer-hint">선택지를 누르면 바로 채점됩니다. 키보드 1~5, ←/→ 도 쓸 수 있습니다.</div>';

  const summary = finished
    ? `
      <div class="gongsi-summary">
        <div><strong>${stats.total}문항 완료</strong> · 정답 ${stats.correct} · 오답 ${stats.wrong}
          (${Math.round((stats.correct / stats.total) * 100)}%)</div>
        <div class="gongsi-summary-actions">
          ${stats.wrong ? `<button class="exam-small-btn" id="gongsiRetryBtn">틀린 ${stats.wrong}문항 다시</button>` : ''}
          <button class="exam-small-btn" id="gongsiRestartBtn">${state.queue ? '전체 문항으로' : '처음부터 다시'}</button>
        </div>
      </div>`
    : '';

  container.innerHTML = `
    <div class="exam-toolbar">
      <div>
        <div class="exam-title">${subject.title}${state.queue ? ' · 오답 다시 풀기' : ''}</div>
        <div class="exam-subtitle">${state.index + 1} / ${list.length}문항 · 풀이 ${stats.answered} · 정답 ${stats.correct} · 오답 ${stats.wrong}</div>
      </div>
      <div class="exam-actions">
        <button class="exam-small-btn" id="gongsiBackBtn">과목 선택</button>
      </div>
    </div>
    ${summary}
    <article class="gongsi-question">
      <div class="gongsi-source">${sourceLabel(q)}</div>
      <p class="gongsi-stem"><strong>${state.index + 1}.</strong> ${escapeHtml(q.stem)}</p>
      ${renderMaterial(q)}
      <ol class="gongsi-options">${options}</ol>
      ${feedback}
      <div class="question-nav gongsi-nav">
        <button class="btn btn-cancel" id="gongsiPrevBtn" ${state.index <= 0 ? 'disabled' : ''}>이전</button>
        <button class="btn ${graded ? 'btn-confirm' : 'btn-cancel'}" id="gongsiNextBtn" ${state.index >= list.length - 1 ? 'disabled' : ''}>다음</button>
      </div>
    </article>
    <div class="question-map">
      ${list.map((item, i) => {
        let status = 'unanswered';
        if (state.answers[item.id] != null) {
          status = state.answers[item.id] === item.answer ? 'graded-correct' : 'graded-wrong';
        }
        return `<button class="question-dot ${status} ${i === state.index ? 'current' : ''}" data-index="${i}">${i + 1}</button>`;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('.gongsi-option').forEach(btn => {
    btn.addEventListener('click', () => choose(Number(btn.dataset.answer)));
  });
  container.querySelectorAll('.question-dot').forEach(btn => {
    btn.addEventListener('click', () => goTo(Number(btn.dataset.index)));
  });
  document.getElementById('gongsiPrevBtn').addEventListener('click', () => goTo(state.index - 1));
  document.getElementById('gongsiNextBtn').addEventListener('click', () => goTo(state.index + 1));
  document.getElementById('gongsiBackBtn').addEventListener('click', () => {
    activeSubject = null;
    renderGongsi();
  });

  const retryBtn = document.getElementById('gongsiRetryBtn');
  if (retryBtn) retryBtn.addEventListener('click', retryWrong);
  const restartBtn = document.getElementById('gongsiRestartBtn');
  if (restartBtn) restartBtn.addEventListener('click', restart);
}

// ───────────────────────── 흐름 제어 ─────────────────────────

function openSubject(key) {
  activeSubject = key;
  const state = subjectProgress(key);
  // 이어 풀기: 저장된 위치가 이미 푼 문항이면 다음 안 푼 문항으로.
  const list = currentList(key);
  const current = list[state.index];
  if (!current || state.answers[current.id] != null) {
    const next = list.findIndex(q => state.answers[q.id] == null);
    if (next >= 0) state.index = next;
  }
  saveProgress();
  renderGongsi();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function choose(value) {
  const state = subjectProgress(activeSubject);
  const q = currentList(activeSubject)[state.index];
  if (!q || state.answers[q.id] != null) return;
  state.answers[q.id] = value;
  saveProgress();
  renderGongsi();
}

function goTo(index) {
  const state = subjectProgress(activeSubject);
  const list = currentList(activeSubject);
  if (index < 0 || index >= list.length) return;
  state.index = index;
  saveProgress();
  renderGongsi();
  // 긴 문제를 아래까지 읽다 넘어가면 새 문제의 첫 줄로 올려 준다.
  const container = document.getElementById('gongsiPractice');
  if (container && container.getBoundingClientRect().top < 0) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function retryWrong() {
  const state = subjectProgress(activeSubject);
  const wrong = currentList(activeSubject).filter(q => state.answers[q.id] !== q.answer);
  if (!wrong.length) return;
  wrong.forEach(q => { delete state.answers[q.id]; });
  state.queue = wrong.map(q => q.id);
  state.index = 0;
  saveProgress();
  renderGongsi();
}

function restart() {
  const state = subjectProgress(activeSubject);
  if (state.queue) {
    // 오답 풀이를 마치고 전체 목록으로 돌아간다(그동안의 답은 유지).
    state.queue = null;
    state.index = 0;
  } else {
    if (!confirm('풀이 기록을 지우고 처음부터 다시 풀까요?')) return;
    progress[activeSubject] = emptyProgress();
  }
  saveProgress();
  renderGongsi();
}

function handleKeydown(e) {
  const view = document.getElementById('gongsiView');
  if (!activeSubject || !view || view.hidden) return;
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const state = subjectProgress(activeSubject);
  if (/^[1-5]$/.test(e.key)) choose(Number(e.key));
  else if (e.key === 'ArrowRight') goTo(state.index + 1);
  else if (e.key === 'ArrowLeft') goTo(state.index - 1);
}

export function initGongsi() {
  document.addEventListener('keydown', handleKeydown);
  renderGongsi();
}
