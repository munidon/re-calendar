// ===== 공법 퀴즈 =====
// 「키워드 한손노트」 부동산공법 이지선다 116문항(국토계획법 35 / 도시개발법 17 /
// 도시정비법 17 / 건축법 20 / 주택법 21 / 농지법 6)을 법 제목별로 골라 푼다.
//
// 원본의 (A / B) 선택지를 그대로 드롭다운으로 옮긴다. 5분 퀴즈와 달리 변형문을
// 만들지 않고, 한 회차 = 고른 법의 전 문항이다. 틀린 문항만 골라 다시 풀 수 있다.

import { LAW_QUIZ_LAWS } from './assets/quiz/law-quiz-bank.js';

const LAW_QUIZ_HISTORY_KEY = 'lawQuizHistory';
const LAW_QUIZ_HISTORY_LIMIT = 20;

const CHOICE_RE = /\[\[([\s\S]*?)\]\]/g;

let selectedPart = LAW_QUIZ_LAWS[0].part;
let lawSession = null;

// ───────────────────────── 유틸 ─────────────────────────

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const m = String(Math.floor(safe / 60)).padStart(2, '0');
  const s = String(safe % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function lawOf(part) {
  return LAW_QUIZ_LAWS.find(law => law.part === part) || LAW_QUIZ_LAWS[0];
}

function partLabel(part) {
  return `PART ${String(part).padStart(2, '0')}`;
}

// 지문을 [일반 텍스트 / 선택지] 조각으로 쪼갠다. 선택지는 원본 순서를 지킨다.
function splitSegments(text) {
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(CHOICE_RE)) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) });
    const raw = match[1].split('|');
    const options = raw.map(option => option.replace(/^\*/, ''));
    segments.push({ options, answer: options[raw.findIndex(option => option.startsWith('*'))] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

function blankIndexes(question) {
  return question.segments.reduce((acc, seg, i) => (seg.options ? acc.concat(i) : acc), []);
}

function answerKey(questionIndex, segmentIndex) {
  return `${questionIndex}:${segmentIndex}`;
}

function isQuestionCorrect(question, questionIndex, answers) {
  return blankIndexes(question).every(
    i => answers[answerKey(questionIndex, i)] === question.segments[i].answer
  );
}

// ───────────────────────── 기록 ─────────────────────────

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAW_QUIZ_HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function saveRecord(record) {
  const history = [record, ...loadHistory()].slice(0, LAW_QUIZ_HISTORY_LIMIT);
  try {
    localStorage.setItem(LAW_QUIZ_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    /* 저장 실패가 풀이를 막지는 않는다 */
  }
}

// ───────────────────────── 렌더 ─────────────────────────

function renderLawQuiz() {
  const container = document.getElementById('lawQuizPractice');
  if (!container) return;

  if (!lawSession) {
    renderIntro(container);
  } else if (lawSession.result) {
    renderResult(container);
  } else {
    renderSolver(container);
  }
}

function renderIntro(container) {
  const history = loadHistory();

  const lawOptions = LAW_QUIZ_LAWS.map(law => `
    <option value="${law.part}" ${law.part === selectedPart ? 'selected' : ''}>
      ${partLabel(law.part)} ${escapeHtml(law.title)} (${law.items.length}문항)
    </option>
  `).join('');

  // 법별 최근 전체 풀이 점수(오답 재풀이는 제외).
  const lawRows = LAW_QUIZ_LAWS.map(law => {
    const last = history.find(record => record.part === law.part && !record.retry);
    const percent = last ? Math.round((last.correct / last.total) * 100) : 0;
    return `
      <div class="quiz-progress-row law-quiz-row">
        <span class="quiz-progress-name">${escapeHtml(law.title)}</span>
        <span class="quiz-progress-bar"><i style="width:${percent}%"></i></span>
        <span class="quiz-progress-count">${last ? `${last.correct}/${last.total}` : `-/${law.items.length}`}</span>
        <span class="quiz-progress-cycle">${last ? escapeHtml(last.elapsed) : ''}</span>
      </div>`;
  }).join('');

  const historyHtml = history.length
    ? `
      <div class="quiz-history">
        <h3>최근 기록</h3>
        <ul>
          ${history.map(record => `
            <li>
              <span class="quiz-history-date">${escapeHtml(record.date)} · ${escapeHtml(lawOf(record.part).title)}${record.retry ? ' (오답)' : ''}</span>
              <span class="quiz-history-score">${record.correct} / ${record.total}</span>
              <span class="quiz-history-time">${escapeHtml(record.elapsed)}</span>
            </li>
          `).join('')}
        </ul>
      </div>`
    : '';

  container.innerHTML = `
    <div class="quiz-intro">
      <p class="quiz-lead">부동산공법 이지선다 <strong>${LAW_QUIZ_LAWS.reduce((sum, law) => sum + law.items.length, 0)}문항</strong>을 법 제목별로 풉니다.</p>
      <ul class="quiz-rules">
        <li>원본의 <strong>(A / B)</strong> 선택지가 드롭다운으로 제시됩니다. 한 문항에 빈칸이 여러 개일 수 있습니다.</li>
        <li>빈칸을 모두 맞혀야 그 문항이 정답입니다.</li>
        <li>채점 후 <strong>틀린 문항만 다시</strong> 풀 수 있습니다.</li>
      </ul>
      <div class="exam-picker law-quiz-picker">
        <div class="exam-field exam-field-wide">
          <label for="lawQuizSelect">법 제목</label>
          <select id="lawQuizSelect">${lawOptions}</select>
        </div>
        <button class="btn btn-confirm" id="lawQuizStartBtn">퀴즈 시작</button>
      </div>
      <div class="quiz-progress-table">${lawRows}</div>
    </div>
    ${historyHtml}
  `;

  document.getElementById('lawQuizSelect').addEventListener('change', (e) => {
    selectedPart = Number(e.target.value);
  });
  document.getElementById('lawQuizStartBtn').addEventListener('click', () => startQuiz(selectedPart));
}

function questionHead(question, index, extra = '') {
  const blanks = blankIndexes(question).length;
  return `
    <div class="quiz-item-head">
      <span class="quiz-no">${index + 1}</span>
      <span class="quiz-subject">${escapeHtml(lawSession.law.title)}</span>
      <span class="quiz-origin">문항 ${String(question.number).padStart(2, '0')}</span>
      ${blanks > 1 ? `<span class="quiz-blank-count">빈칸 ${blanks}</span>` : ''}
      ${extra}
    </div>`;
}

function renderQuestionBody(question, questionIndex, graded) {
  return question.segments.map((segment, segmentIndex) => {
    if (!segment.options) return escapeHtml(segment.text);

    const selected = lawSession.answers[answerKey(questionIndex, segmentIndex)];
    if (graded) {
      const correct = selected === segment.answer;
      const chosen = selected == null ? '(미응답)' : selected;
      return `<span class="quiz-blank-result ${correct ? 'is-correct' : 'is-wrong'}">${escapeHtml(chosen)}</span>`;
    }

    const optionsHtml = segment.options
      .map(option => `<option value="${escapeHtml(option)}" ${option === selected ? 'selected' : ''}>${escapeHtml(option)}</option>`)
      .join('');
    return `
      <select class="quiz-blank" data-question="${questionIndex}" data-segment="${segmentIndex}"
              aria-label="${questionIndex + 1}번 문항 빈칸">
        <option value="" ${selected ? '' : 'selected'}>― 선택 ―</option>
        ${optionsHtml}
      </select>`;
  }).join('');
}

function countBlanks(questions) {
  return questions.reduce((sum, question) => sum + blankIndexes(question).length, 0);
}

function countAnswered() {
  return Object.values(lawSession.answers).filter(Boolean).length;
}

function renderSolver(container) {
  const totalBlanks = countBlanks(lawSession.questions);

  const questionsHtml = lawSession.questions.map((question, index) => `
    <li class="quiz-item">
      ${questionHead(question, index)}
      <p class="quiz-sentence">${renderQuestionBody(question, index, false)}</p>
    </li>
  `).join('');

  container.innerHTML = `
    <div class="quiz-toolbar">
      <div class="quiz-progress">
        ${partLabel(lawSession.law.part)} ${escapeHtml(lawSession.law.title)}${lawSession.retry ? ' · 오답' : ''} ·
        <strong id="lawQuizAnswered">${countAnswered()}</strong> / ${totalBlanks} 응답
      </div>
      <div class="quiz-actions">
        <button class="exam-small-btn" id="lawQuizAbortBtn">그만두기</button>
        <button class="btn btn-confirm" id="lawQuizSubmitBtn">제출</button>
      </div>
    </div>
    <ol class="quiz-list">${questionsHtml}</ol>
    <div class="quiz-footer">
      <button class="btn btn-confirm" id="lawQuizSubmitBottomBtn">제출하고 채점</button>
    </div>
  `;

  container.querySelectorAll('.quiz-blank').forEach(select => {
    select.addEventListener('change', (e) => {
      const key = answerKey(Number(e.target.dataset.question), Number(e.target.dataset.segment));
      lawSession.answers[key] = e.target.value || null;
      e.target.classList.toggle('is-filled', Boolean(e.target.value));
      const counter = document.getElementById('lawQuizAnswered');
      if (counter) counter.textContent = String(countAnswered());
    });
    select.classList.toggle('is-filled', Boolean(select.value));
  });

  document.getElementById('lawQuizSubmitBtn').addEventListener('click', submitQuiz);
  document.getElementById('lawQuizSubmitBottomBtn').addEventListener('click', submitQuiz);
  document.getElementById('lawQuizAbortBtn').addEventListener('click', abortQuiz);
}

function renderResult(container) {
  const { result } = lawSession;

  const reviewHtml = lawSession.questions.map((question, index) => {
    const wrong = blankIndexes(question).filter(
      i => lawSession.answers[answerKey(index, i)] !== question.segments[i].answer
    );
    const mark = wrong.length ? '오답' : '정답';

    const answerLines = wrong.length
      ? `
        <p class="quiz-answer-line">
          <span class="quiz-answer-label">정답</span>
          <span class="quiz-answer-text">${wrong.map(i => escapeHtml(question.segments[i].answer)).join(', ')}</span>
        </p>`
      : '';

    return `
      <li class="quiz-item ${wrong.length ? 'is-wrong' : 'is-correct'}">
        ${questionHead(question, index, `<span class="quiz-mark">${mark}</span>`)}
        <p class="quiz-sentence">${renderQuestionBody(question, index, true)}</p>
        ${answerLines}
      </li>`;
  }).join('');

  const wrongCount = result.total - result.correct;

  container.innerHTML = `
    <div class="quiz-result-head">
      <div class="quiz-score">
        <span class="quiz-score-value">${result.correct}</span>
        <span class="quiz-score-total">/ ${result.total}</span>
      </div>
      <div class="quiz-result-meta">
        <div>${partLabel(lawSession.law.part)} <strong>${escapeHtml(lawSession.law.title)}</strong>${lawSession.retry ? ' · 오답' : ''}</div>
        <div>소요 시간 <strong>${escapeHtml(result.elapsed)}</strong></div>
        <div>정답률 <strong>${result.total ? Math.round((result.correct / result.total) * 100) : 0}%</strong></div>
      </div>
      <div class="law-quiz-result-actions">
        ${wrongCount ? `<button class="exam-small-btn" id="lawQuizRetryBtn">틀린 ${wrongCount}문항 다시</button>` : ''}
        <button class="btn btn-confirm" id="lawQuizRestartBtn">처음으로</button>
      </div>
    </div>
    <ol class="quiz-list quiz-review">${reviewHtml}</ol>
  `;

  document.getElementById('lawQuizRestartBtn').addEventListener('click', () => {
    lawSession = null;
    renderLawQuiz();
  });
  const retryBtn = document.getElementById('lawQuizRetryBtn');
  if (retryBtn) retryBtn.addEventListener('click', retryWrong);
}

// ───────────────────────── 흐름 제어 ─────────────────────────

function beginSession(law, items, retry) {
  lawSession = {
    law,
    retry,
    questions: items.map(item => ({ number: item.n, text: item.t, segments: splitSegments(item.t) })),
    answers: {},
    startedAt: Date.now(),
    result: null
  };
  renderLawQuiz();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startQuiz(part) {
  const law = lawOf(part);
  beginSession(law, law.items, false);
}

function retryWrong() {
  const { law, questions, answers } = lawSession;
  const wrongItems = questions
    .filter((question, index) => !isQuestionCorrect(question, index, answers))
    .map(question => ({ n: question.number, t: question.text }));
  if (!wrongItems.length) return;
  beginSession(law, wrongItems, true);
}

function submitQuiz() {
  if (!lawSession || lawSession.result) return;

  const unanswered = countBlanks(lawSession.questions) - countAnswered();
  if (unanswered > 0 && !confirm(`미응답 빈칸 ${unanswered}개가 있습니다. 그대로 제출할까요?`)) return;

  const correct = lawSession.questions
    .filter((question, index) => isQuestionCorrect(question, index, lawSession.answers)).length;
  const total = lawSession.questions.length;
  const elapsed = formatClock(Math.round((Date.now() - lawSession.startedAt) / 1000));

  lawSession.result = { correct, total, elapsed };

  saveRecord({
    date: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }),
    part: lawSession.law.part,
    retry: lawSession.retry,
    correct,
    total,
    elapsed
  });

  renderLawQuiz();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function abortQuiz() {
  if (!confirm('현재 퀴즈를 그만두고 처음 화면으로 돌아갈까요?')) return;
  lawSession = null;
  renderLawQuiz();
}

export function initLawQuiz() {
  renderLawQuiz();
}
