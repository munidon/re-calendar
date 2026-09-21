// ===== 5분 퀴즈 =====
// 「3분 벼락치기 마무리 노트」 필수 지문 304개(학개론 50 / 민법 54 / 중개사법 50 /
// 공법 50 / 공시법 50 / 세법 50)를 원본 그대로 싣고, 원본에서 초록색으로 강조된
// 구간 하나를 빈칸으로 뚫어 [원문 / 변형문] 2지선다 드롭다운으로 풀게 한다.

import { QUIZ_BANK, QUIZ_SUBJECTS, QUIZ_SUBJECT_ORDER } from './assets/quiz/quiz-bank.js';
import { mutate } from './assets/quiz/quiz-mutator.js';

const QUIZ_SIZE = 20;
const QUIZ_SECONDS = 5 * 60;
// 이보다 긴 강조 구간은 빈칸으로 뚫지 않는다. 드롭다운에 문장이 통째로 들어가면
// 키워드를 묻는 문제가 아니게 되기 때문. (강조 구간의 90%가 29자 이내)
const MAX_BLANK_LENGTH = 35;
// 한 회차에 원문 그대로 나가는 문항의 상한. 이를 넘으면 같은 과목의 다른 지문으로
// 바꿔 끼워 풀 거리가 남도록 한다.
const MAX_REFERENCE_QUESTIONS = 6;
const QUIZ_HISTORY_KEY = 'quizHistory';
const QUIZ_HISTORY_LIMIT = 20;

const GREEN_RE = /\{\{([\s\S]*?)\}\}/g;

let quizSession = null;   // { questions, answers, startedAt, deadline, result }
let quizTimerId = null;

// ───────────────────────── 유틸 ─────────────────────────

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shuffle(list, rng = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const m = String(Math.floor(safe / 60)).padStart(2, '0');
  const s = String(safe % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// 지문을 [일반 텍스트 / 초록색 강조] 조각으로 쪼갠다.
function splitSegments(text) {
  const segments = [];
  let cursor = 0;
  GREEN_RE.lastIndex = 0;
  for (const match of text.matchAll(GREEN_RE)) {
    if (match.index > cursor) segments.push({ green: false, text: text.slice(cursor, match.index) });
    segments.push({ green: true, text: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ green: false, text: text.slice(cursor) });
  return segments;
}

// ───────────────────────── 출제 ─────────────────────────

// 지문 하나를 문항으로 만든다.
// 강조 구간이 너무 길거나 마땅히 바꿀 만한 곳이 없으면 빈칸을 만들지 않고
// 원문 그대로 제시한다(= 풀지 않아도 옳은 선지).
function buildQuestion(item, rng) {
  const segments = splitSegments(item.t);
  const base = {
    subject: item.s,
    number: item.n,
    segments
  };

  const candidates = shuffle(
    segments.reduce((acc, seg, i) => (seg.green ? acc.concat(i) : acc), []),
    rng
  )
    .filter(index => segments[index].text.length <= MAX_BLANK_LENGTH)
    .sort((a, b) => segments[a].text.length - segments[b].text.length); // 짧은 키워드 우선

  for (const index of candidates) {
    const answer = segments[index].text;
    const mutated = mutate(answer, rng);
    if (!mutated) continue;
    return {
      ...base,
      kind: 'blank',
      blankIndex: index,
      answer,
      mutationType: mutated.type,
      options: shuffle([answer, mutated.text], rng)
    };
  }

  return { ...base, kind: 'reference', blankIndex: -1, answer: null };
}

// 전과목 균등 배분: 6과목 × 3문항 = 18문항을 깔고,
// 남는 2문항은 매 회차 무작위로 다른 2과목에 얹어 장기적으로 균형을 맞춘다.
function planSubjectQuota(rng) {
  const base = Math.floor(QUIZ_SIZE / QUIZ_SUBJECT_ORDER.length);
  const extra = QUIZ_SIZE - base * QUIZ_SUBJECT_ORDER.length;
  const quota = {};
  QUIZ_SUBJECT_ORDER.forEach(subject => { quota[subject] = base; });
  shuffle(QUIZ_SUBJECT_ORDER, rng).slice(0, extra).forEach(subject => { quota[subject] += 1; });
  return quota;
}

function buildQuiz(rng = Math.random) {
  const quota = planSubjectQuota(rng);
  const pools = {};
  QUIZ_SUBJECT_ORDER.forEach(subject => {
    pools[subject] = shuffle(QUIZ_BANK.filter(item => item.s === subject), rng);
  });

  const questions = [];
  const leftovers = {};
  for (const subject of QUIZ_SUBJECT_ORDER) {
    pools[subject].slice(0, quota[subject]).forEach(item => {
      questions.push(buildQuestion(item, rng));
    });
    leftovers[subject] = pools[subject].slice(quota[subject]);
  }

  // 뽑기 운에 따라 원문 문항만 잔뜩 걸리면 풀 게 없는 회차가 된다.
  // 상한을 넘으면 같은 과목의 남은 지문 중 빈칸을 만들 수 있는 것으로 바꿔 끼운다.
  let excess = questions.filter(q => q.kind === 'reference').length - MAX_REFERENCE_QUESTIONS;
  for (let i = 0; i < questions.length && excess > 0; i++) {
    if (questions[i].kind !== 'reference') continue;
    const pool = leftovers[questions[i].subject];
    while (pool.length) {
      const replacement = buildQuestion(pool.shift(), rng);
      if (replacement.kind !== 'blank') continue;
      questions[i] = replacement;
      excess--;
      break;
    }
  }

  return shuffle(questions, rng).slice(0, QUIZ_SIZE);
}

function isAnswered(question, answer) {
  return question.kind === 'reference' || Boolean(answer);
}

function isCorrect(question, answer) {
  return question.kind === 'reference' || answer === question.answer;
}

function countBlankQuestions(questions) {
  return questions.filter(question => question.kind === 'blank').length;
}

// ───────────────────────── 기록 ─────────────────────────

function loadQuizHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUIZ_HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function saveQuizRecord(record) {
  const history = [record, ...loadQuizHistory()].slice(0, QUIZ_HISTORY_LIMIT);
  try {
    localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    /* 저장 실패는 풀이를 막지 않는다 */
  }
}

// ───────────────────────── 렌더 ─────────────────────────

export function renderQuiz() {
  const container = document.getElementById('quizPractice');
  if (!container) return;

  if (!quizSession) {
    renderQuizIntro(container);
  } else if (quizSession.result) {
    renderQuizResult(container);
  } else {
    renderQuizSolver(container);
  }
}

function renderQuizIntro(container) {
  const history = loadQuizHistory();
  const counts = QUIZ_SUBJECT_ORDER
    .map(subject => `${subject} ${QUIZ_BANK.filter(item => item.s === subject).length}`)
    .join(' · ');

  const historyHtml = history.length
    ? `
      <div class="quiz-history">
        <h3>최근 기록</h3>
        <ul>
          ${history.map(record => `
            <li>
              <span class="quiz-history-date">${escapeHtml(record.date)}</span>
              <span class="quiz-history-score">${record.correct} / ${record.total}</span>
              <span class="quiz-history-time">${escapeHtml(record.elapsed)}</span>
            </li>
          `).join('')}
        </ul>
      </div>`
    : '';

  container.innerHTML = `
    <div class="quiz-intro">
      <p class="quiz-lead">필수 지문 <strong>${QUIZ_BANK.length}개</strong>에서 <strong>${QUIZ_SIZE}문항</strong>을 전과목 균등 배분으로 뽑습니다.</p>
      <ul class="quiz-rules">
        <li>원본에서 초록색으로 강조된 구간 하나가 빈칸으로 바뀝니다.</li>
        <li>빈칸마다 <strong>원문</strong>과 <strong>변형문</strong> 두 개가 드롭다운으로 제시됩니다.</li>
        <li>강조 구간이 너무 길거나 바꿀 만한 곳이 없는 지문은 <strong>원문 그대로</strong> 제시되며 정답 처리됩니다.</li>
        <li>제한시간은 <strong>5분</strong>, 시간이 다 되면 자동 제출됩니다.</li>
      </ul>
      <p class="quiz-bank-note">수록 지문: ${escapeHtml(counts)}</p>
      <button class="btn btn-confirm" id="quizStartBtn">퀴즈 시작</button>
    </div>
    ${historyHtml}
  `;

  document.getElementById('quizStartBtn').addEventListener('click', startQuiz);
}

function renderQuestionBody(question, index, options) {
  const { graded = false } = options || {};
  const selected = quizSession.answers[index];

  return question.segments.map((segment, segmentIndex) => {
    // 원문 그대로 내는 문항은 빈칸 없이 강조만 살려 보여 준다.
    if (question.kind === 'blank' && segmentIndex === question.blankIndex) {
      if (graded) {
        const correct = selected === question.answer;
        const chosen = selected == null ? '(미응답)' : selected;
        return `<span class="quiz-blank-result ${correct ? 'is-correct' : 'is-wrong'}">${escapeHtml(chosen)}</span>`;
      }
      const optionsHtml = question.options
        .map(option => `<option value="${escapeHtml(option)}" ${option === selected ? 'selected' : ''}>${escapeHtml(option)}</option>`)
        .join('');
      return `
        <select class="quiz-blank" data-index="${index}" aria-label="${index + 1}번 빈칸">
          <option value="" ${selected ? '' : 'selected'}>― 선택 ―</option>
          ${optionsHtml}
        </select>`;
    }
    if (segment.green) {
      return `<span class="quiz-green">${escapeHtml(segment.text)}</span>`;
    }
    return escapeHtml(segment.text);
  }).join('');
}

function renderQuizSolver(container) {
  const blankTotal = countBlankQuestions(quizSession.questions);
  const answered = quizSession.answers.filter(Boolean).length;
  const remaining = Math.ceil((quizSession.deadline - Date.now()) / 1000);

  const questionsHtml = quizSession.questions.map((question, index) => `
    <li class="quiz-item ${question.kind === 'reference' ? 'is-reference' : ''}">
      <div class="quiz-item-head">
        <span class="quiz-no">${index + 1}</span>
        <span class="quiz-subject">${escapeHtml(QUIZ_SUBJECTS[question.subject] || question.subject)}</span>
        <span class="quiz-origin">지문 ${String(question.number).padStart(2, '0')}</span>
        ${question.kind === 'reference' ? '<span class="quiz-ref-badge">원문 그대로</span>' : ''}
      </div>
      <p class="quiz-sentence">${renderQuestionBody(question, index, { graded: false })}</p>
    </li>
  `).join('');

  container.innerHTML = `
    <div class="quiz-toolbar">
      <div class="quiz-progress"><strong id="quizAnswered">${answered}</strong> / ${blankTotal} 응답</div>
      <div class="quiz-timer" id="quizTimer">${formatClock(remaining)}</div>
      <div class="quiz-actions">
        <button class="exam-small-btn" id="quizAbortBtn">그만두기</button>
        <button class="btn btn-confirm" id="quizSubmitBtn">제출</button>
      </div>
    </div>
    <ol class="quiz-list">${questionsHtml}</ol>
    <div class="quiz-footer">
      <button class="btn btn-confirm" id="quizSubmitBottomBtn">제출하고 채점</button>
    </div>
  `;

  container.querySelectorAll('.quiz-blank').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = Number(e.target.dataset.index);
      quizSession.answers[index] = e.target.value || null;
      e.target.classList.toggle('is-filled', Boolean(e.target.value));
      const counter = document.getElementById('quizAnswered');
      if (counter) counter.textContent = String(quizSession.answers.filter(Boolean).length);
    });
    select.classList.toggle('is-filled', Boolean(select.value));
  });

  document.getElementById('quizSubmitBtn').addEventListener('click', () => submitQuiz(false));
  document.getElementById('quizSubmitBottomBtn').addEventListener('click', () => submitQuiz(false));
  document.getElementById('quizAbortBtn').addEventListener('click', abortQuiz);
}

function renderQuizResult(container) {
  const { result } = quizSession;

  const subjectRows = QUIZ_SUBJECT_ORDER
    .filter(subject => result.bySubject[subject])
    .map(subject => {
      const stat = result.bySubject[subject];
      return `
        <div class="quiz-subject-stat">
          <span class="quiz-subject-name">${escapeHtml(subject)}</span>
          <span class="quiz-subject-score">${stat.correct} / ${stat.total}</span>
        </div>`;
    }).join('');

  const reviewHtml = quizSession.questions.map((question, index) => {
    const selected = quizSession.answers[index];
    const reference = question.kind === 'reference';
    const correct = isCorrect(question, selected);
    return `
      <li class="quiz-item ${reference ? 'is-reference' : correct ? 'is-correct' : 'is-wrong'}">
        <div class="quiz-item-head">
          <span class="quiz-no">${index + 1}</span>
          <span class="quiz-subject">${escapeHtml(QUIZ_SUBJECTS[question.subject] || question.subject)}</span>
          <span class="quiz-origin">지문 ${String(question.number).padStart(2, '0')}</span>
          <span class="quiz-mark">${reference ? '원문' : correct ? '정답' : '오답'}</span>
        </div>
        <p class="quiz-sentence">${renderQuestionBody(question, index, { graded: true })}</p>
        ${correct ? '' : `
          <p class="quiz-answer-line">
            <span class="quiz-answer-label">원문</span>
            <span class="quiz-answer-text">${escapeHtml(question.answer)}</span>
            <span class="quiz-mutation">${escapeHtml(question.mutationType)}</span>
          </p>`}
      </li>`;
  }).join('');

  container.innerHTML = `
    <div class="quiz-result-head">
      <div class="quiz-score">
        <span class="quiz-score-value">${result.correct}</span>
        <span class="quiz-score-total">/ ${result.total}</span>
      </div>
      <div class="quiz-result-meta">
        <div>소요 시간 <strong>${escapeHtml(result.elapsed)}</strong></div>
        ${result.blankTotal
          ? `<div>선택 문항 <strong>${result.blankCorrect} / ${result.blankTotal}</strong> (${Math.round((result.blankCorrect / result.blankTotal) * 100)}%)</div>`
          : ''}
        ${result.referenceTotal
          ? `<div class="quiz-ref-note">원문 그대로 제시된 <strong>${result.referenceTotal}문항</strong>은 정답 처리했습니다.</div>`
          : ''}
        ${result.timedOut ? '<div class="quiz-timeout">시간 종료로 자동 제출되었습니다.</div>' : ''}
      </div>
      <button class="btn btn-confirm" id="quizRestartBtn">새 퀴즈</button>
    </div>
    <div class="quiz-subject-stats">${subjectRows}</div>
    <ol class="quiz-list quiz-review">${reviewHtml}</ol>
  `;

  document.getElementById('quizRestartBtn').addEventListener('click', startQuiz);
}

// ───────────────────────── 흐름 제어 ─────────────────────────

function startQuiz() {
  const questions = buildQuiz();
  if (!questions.length) {
    alert('퀴즈 문항을 만들지 못했습니다.');
    return;
  }
  quizSession = {
    questions,
    answers: new Array(questions.length).fill(null),
    startedAt: Date.now(),
    deadline: Date.now() + QUIZ_SECONDS * 1000,
    result: null
  };
  renderQuiz();
  startQuizTimer();
}

function startQuizTimer() {
  stopQuizTimer();
  quizTimerId = setInterval(() => {
    if (!quizSession || quizSession.result) {
      stopQuizTimer();
      return;
    }
    const remaining = Math.ceil((quizSession.deadline - Date.now()) / 1000);
    const timer = document.getElementById('quizTimer');
    if (timer) {
      timer.textContent = formatClock(remaining);
      timer.classList.toggle('is-urgent', remaining <= 30);
    }
    if (remaining <= 0) submitQuiz(true);
  }, 250);
}

function stopQuizTimer() {
  if (quizTimerId) {
    clearInterval(quizTimerId);
    quizTimerId = null;
  }
}

function submitQuiz(timedOut) {
  if (!quizSession || quizSession.result) return;

  const unanswered = quizSession.questions.filter(
    (question, index) => !isAnswered(question, quizSession.answers[index])
  ).length;
  if (!timedOut && unanswered > 0 && !confirm(`미응답 ${unanswered}문항이 있습니다. 그대로 제출할까요?`)) return;

  stopQuizTimer();

  const bySubject = {};
  let correct = 0;
  quizSession.questions.forEach((question, index) => {
    const ok = isCorrect(question, quizSession.answers[index]);
    if (ok) correct++;
    const stat = bySubject[question.subject] || (bySubject[question.subject] = { correct: 0, total: 0 });
    stat.total++;
    if (ok) stat.correct++;
  });

  const elapsedSeconds = Math.min(
    QUIZ_SECONDS,
    Math.round((Date.now() - quizSession.startedAt) / 1000)
  );

  const blankTotal = countBlankQuestions(quizSession.questions);
  const referenceTotal = quizSession.questions.length - blankTotal;

  quizSession.result = {
    correct,
    total: quizSession.questions.length,
    blankTotal,
    referenceTotal,
    blankCorrect: correct - referenceTotal,
    bySubject,
    elapsed: formatClock(elapsedSeconds),
    timedOut: Boolean(timedOut)
  };

  saveQuizRecord({
    date: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }),
    correct: quizSession.result.blankCorrect,
    total: quizSession.result.blankTotal,
    elapsed: quizSession.result.elapsed
  });

  renderQuiz();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function abortQuiz() {
  if (!confirm('현재 퀴즈를 그만두고 처음 화면으로 돌아갈까요?')) return;
  stopQuizTimer();
  quizSession = null;
  renderQuiz();
}

export function initQuiz() {
  renderQuiz();
}
