// ===== 5분 퀴즈 =====
// 「3분 벼락치기 마무리 노트」 필수 지문 304개(학개론 50 / 민법 54 / 중개사법 50 /
// 공법 50 / 공시법 50 / 세법 50)를 원본 그대로 싣고, 원본에서 초록색으로 강조된
// 구간을 빈칸으로 뚫어 [원문 / 변형문] 2지선다 드롭다운으로 풀게 한다.
//
// 출제 단위는 "지문"이 아니라 "빈칸"이다. 한 지문에 짧은 강조가 여러 개면
// 모두 뚫으므로 한 지문에 드롭다운이 2~3개 달릴 수 있다.
//
// 노출은 과목별 순환 큐로 관리한다. 한 바퀴를 도는 동안 같은 지문은 다시
// 나오지 않고, 틀린 빈칸은 복습 대기에 올라가 다음 회차에 우선 출제된다.

import { QUIZ_BANK, QUIZ_SUBJECTS, QUIZ_SUBJECT_ORDER } from './assets/quiz/quiz-bank.js';
import { mutate } from './assets/quiz/quiz-mutator.js';

const QUIZ_BLANKS = 30;                 // 한 회차에 푸는 빈칸 수
// 제한시간은 두지 않는다. 탭 이름의 "5분"은 목표 감각일 뿐이고,
// 실제로 걸린 시간만 스톱워치로 재서 결과와 기록에 남긴다.
const BLANKS_PER_SUBJECT = QUIZ_BLANKS / QUIZ_SUBJECT_ORDER.length;
const MAX_BLANKS_PER_ITEM = 3;          // 한 지문에서 뚫는 빈칸 수 상한
const REVIEW_PER_SUBJECT = 2;           // 과목별 복습 빈칸 상한
const MAX_REFERENCE_ITEMS = 5;          // 회차당 "원문 그대로" 지문 상한
// 이보다 긴 강조 구간은 빈칸으로 뚫지 않는다. 드롭다운에 문장이 통째로 들어가면
// 키워드를 묻는 문제가 아니게 되기 때문. (강조 구간의 90%가 29자 이내)
const MAX_BLANK_LENGTH = 35;

const QUIZ_HISTORY_KEY = 'quizHistory';
const QUIZ_PROGRESS_KEY = 'quizProgress';
const QUIZ_HISTORY_LIMIT = 20;

const GREEN_RE = /\{\{([\s\S]*?)\}\}/g;

let quizSession = null;

const itemKey = item => `${item.s}-${item.n}`;
const BANK_BY_KEY = new Map(QUIZ_BANK.map(item => [itemKey(item), item]));

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

// ───────────────────── 학습 진도(순환 큐 · 복습) ─────────────────────

function loadProgress() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(QUIZ_PROGRESS_KEY) || '{}') || {};
  } catch (e) {
    saved = {};
  }
  return {
    seen: saved.seen && typeof saved.seen === 'object' ? saved.seen : {},
    review: Array.isArray(saved.review) ? saved.review : [],
    cycles: saved.cycles && typeof saved.cycles === 'object' ? saved.cycles : {}
  };
}

function saveProgress(progress) {
  try {
    localStorage.setItem(QUIZ_PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {
    /* 저장 실패가 풀이를 막지는 않는다 */
  }
}

function cycleOf(progress, subject) {
  return progress.cycles[subject] || 1;
}

// 이번 바퀴에 아직 안 나온 지문들.
function unseenOf(progress, subject, rng) {
  return shuffle(QUIZ_BANK.filter(item => item.s === subject && !progress.seen[itemKey(item)]), rng);
}

// 바퀴를 넘긴다. 이번 바퀴에 나온 기록을 비우고 모든 지문을 다시 후보로 돌린다.
function rollCycle(progress, subject, rng) {
  QUIZ_BANK.filter(item => item.s === subject)
    .forEach(item => { delete progress.seen[itemKey(item)]; });
  progress.cycles[subject] = cycleOf(progress, subject) + 1;
  return shuffle(QUIZ_BANK.filter(item => item.s === subject), rng);
}

// ───────────────────────── 출제 ─────────────────────────

// "A가 오르면 B는 내린다" 처럼 인과로 묶인 두 자리를 모두 뚫고 양쪽 다 뒤집으면
// 그 문장도 참이 되어 버린다(수익률 하락 → MBS 가격 상승). 제대로 아는 사람이
// 오답 처리되므로, 이런 짝은 한쪽만 뚫는다.
const REVERSAL_TYPES = new Set(['방향 반전', '서술어 뒤집기']);
const CAUSAL_RE = /하면|할수록|될수록|수록|으면|이면|인하여|므로|따라서|때문/;

function isCoupledReversal(segments, kept, candidate) {
  if (!REVERSAL_TYPES.has(candidate.mutationType)) return false;
  return kept.some(blank => {
    if (!REVERSAL_TYPES.has(blank.mutationType)) return false;
    const [from, to] = blank.segmentIndex < candidate.segmentIndex
      ? [blank.segmentIndex, candidate.segmentIndex]
      : [candidate.segmentIndex, blank.segmentIndex];
    const between = segments.slice(from + 1, to).map(segment => segment.text).join('');
    return CAUSAL_RE.test(between);
  });
}

/**
 * 지문 하나에서 빈칸을 만든다.
 * limit    : 이 지문에서 뚫을 빈칸 수 상한
 * onlyIndex: 특정 강조 구간만 뚫고 싶을 때(복습)의 세그먼트 인덱스
 * 빈칸을 하나도 못 만들면 blanks 가 빈 배열 = "원문 그대로" 지문.
 */
function buildItem(item, rng, limit, onlyIndex = null) {
  const segments = splitSegments(item.t);
  const greenIndexes = segments.reduce((acc, seg, i) => (seg.green ? acc.concat(i) : acc), []);

  const candidates = onlyIndex !== null
    ? [onlyIndex]
    : shuffle(greenIndexes, rng)
        .filter(i => segments[i].text.length <= MAX_BLANK_LENGTH)
        .sort((a, b) => segments[a].text.length - segments[b].text.length);

  const blanks = [];
  for (const index of candidates) {
    if (blanks.length >= limit) break;
    const segment = segments[index];
    if (!segment || !segment.green || segment.text.length > MAX_BLANK_LENGTH) continue;
    const mutated = mutate(segment.text, rng);
    if (!mutated) continue;
    const candidate = {
      segmentIndex: index,
      answer: segment.text,
      mutationType: mutated.type,
      options: shuffle([segment.text, mutated.text], rng)
    };
    if (isCoupledReversal(segments, blanks, candidate)) continue;
    blanks.push(candidate);
  }

  blanks.sort((a, b) => a.segmentIndex - b.segmentIndex);
  return { subject: item.s, number: item.n, key: itemKey(item), segments, blanks };
}

function buildQuiz(rng = Math.random) {
  const progress = loadProgress();
  const questions = [];
  let referenceCount = 0;

  for (const subject of QUIZ_SUBJECT_ORDER) {
    let need = BLANKS_PER_SUBJECT;
    const usedKeys = new Set();

    // 1) 복습 대기 먼저 — 지난 회차에 틀린 바로 그 빈칸을 다시 낸다.
    const pending = progress.review.filter(entry => entry.startsWith(`${subject}-`));
    for (const entry of shuffle(pending, rng).slice(0, REVIEW_PER_SUBJECT)) {
      if (need <= 0) break;
      const [key, segment] = entry.split('#');
      const item = BANK_BY_KEY.get(key);
      if (!item || usedKeys.has(key)) continue;
      const built = buildItem(item, rng, 1, Number(segment));
      if (!built.blanks.length) continue;
      questions.push({ ...built, review: true });
      usedKeys.add(key);
      need -= built.blanks.length;
    }

    // 2) 나머지는 순환 큐에서 채운다.
    const tried = new Set();
    let queue = unseenOf(progress, subject, rng);
    let rollovers = 0;

    while (need > 0) {
      const item = queue.shift();

      if (!item) {
        // 이번 바퀴에 남은 지문으로는 빈칸을 더 못 만든다(남은 게 전부 원문 지문인 경우).
        // 바퀴를 넘겨서라도 회차 분량은 채운다.
        if (rollovers++ >= 1) break;
        tried.clear();
        queue = rollCycle(progress, subject, rng).filter(next => !usedKeys.has(itemKey(next)));
        continue;
      }

      const key = itemKey(item);
      if (usedKeys.has(key) || tried.has(key)) continue;
      tried.add(key);

      const built = buildItem(item, rng, Math.min(MAX_BLANKS_PER_ITEM, need));
      if (built.blanks.length) {
        questions.push(built);
        usedKeys.add(key);
        progress.seen[key] = true;
        need -= built.blanks.length;
      } else if (referenceCount < MAX_REFERENCE_ITEMS) {
        // 변형할 수 없는 지문은 원문 그대로 끼워 넣는다(채점에는 넣지 않음).
        questions.push(built);
        usedKeys.add(key);
        progress.seen[key] = true;
        referenceCount++;
      }
      // 원문 상한을 넘겼으면 내보내지 않고 seen 도 남기지 않는다 → 다음 회차에 다시 후보가 된다.
    }
  }

  saveProgress(progress);
  return shuffle(questions, rng);
}

function countBlanks(questions) {
  return questions.reduce((sum, question) => sum + question.blanks.length, 0);
}

function answerKey(questionIndex, segmentIndex) {
  return `${questionIndex}:${segmentIndex}`;
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
    /* 저장 실패가 풀이를 막지는 않는다 */
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
  const progress = loadProgress();
  const history = loadQuizHistory();

  const progressRows = QUIZ_SUBJECT_ORDER.map(subject => {
    const all = QUIZ_BANK.filter(item => item.s === subject);
    const done = all.filter(item => progress.seen[itemKey(item)]).length;
    const review = progress.review.filter(entry => entry.startsWith(`${subject}-`)).length;
    const percent = Math.round((done / all.length) * 100);
    return `
      <div class="quiz-progress-row">
        <span class="quiz-progress-name">${escapeHtml(subject)}</span>
        <span class="quiz-progress-bar"><i style="width:${percent}%"></i></span>
        <span class="quiz-progress-count">${done}/${all.length}</span>
        <span class="quiz-progress-cycle">${cycleOf(progress, subject)}바퀴</span>
        <span class="quiz-progress-review">${review ? `복습 ${review}` : ''}</span>
      </div>`;
  }).join('');

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
      <p class="quiz-lead">필수 지문 <strong>${QUIZ_BANK.length}개</strong>에서 <strong>빈칸 ${QUIZ_BLANKS}개</strong>를 전과목 균등 배분으로 뽑습니다.</p>
      <ul class="quiz-rules">
        <li>강조 구간마다 <strong>원문</strong>과 <strong>변형문</strong>이 드롭다운으로 제시됩니다. 한 지문에 빈칸이 여러 개일 수 있습니다.</li>
        <li>한 바퀴를 도는 동안 <strong>같은 지문은 다시 나오지 않습니다.</strong></li>
        <li>틀린 빈칸은 <strong>복습 대기</strong>에 올라가 다음 회차에 우선 출제됩니다.</li>
        <li>강조 구간이 너무 길거나 바꿀 만한 곳이 없는 지문은 <strong>원문 그대로</strong> 제시됩니다(채점 제외).</li>
        <li>제한시간은 없습니다. 걸린 시간만 재서 기록에 남습니다 — <strong>5분</strong>을 목표로 풀어 보세요.</li>
      </ul>
      <div class="quiz-progress-table">${progressRows}</div>
      <button class="btn btn-confirm" id="quizStartBtn">퀴즈 시작</button>
    </div>
    ${historyHtml}
  `;

  document.getElementById('quizStartBtn').addEventListener('click', startQuiz);
}

function renderQuestionBody(question, questionIndex, graded) {
  const blankBySegment = new Map(question.blanks.map(blank => [blank.segmentIndex, blank]));

  return question.segments.map((segment, segmentIndex) => {
    const blank = blankBySegment.get(segmentIndex);
    if (!blank) {
      return segment.green
        ? `<span class="quiz-green">${escapeHtml(segment.text)}</span>`
        : escapeHtml(segment.text);
    }

    const selected = quizSession.answers[answerKey(questionIndex, segmentIndex)];
    if (graded) {
      const correct = selected === blank.answer;
      const chosen = selected == null ? '(미응답)' : selected;
      return `<span class="quiz-blank-result ${correct ? 'is-correct' : 'is-wrong'}">${escapeHtml(chosen)}</span>`;
    }

    const optionsHtml = blank.options
      .map(option => `<option value="${escapeHtml(option)}" ${option === selected ? 'selected' : ''}>${escapeHtml(option)}</option>`)
      .join('');
    return `
      <select class="quiz-blank" data-question="${questionIndex}" data-segment="${segmentIndex}"
              aria-label="${questionIndex + 1}번 지문 빈칸">
        <option value="" ${selected ? '' : 'selected'}>― 선택 ―</option>
        ${optionsHtml}
      </select>`;
  }).join('');
}

function questionHead(question, index, extra = '') {
  const badges = [];
  if (question.review) badges.push('<span class="quiz-review-badge">복습</span>');
  if (!question.blanks.length) badges.push('<span class="quiz-ref-badge">원문 그대로</span>');
  return `
    <div class="quiz-item-head">
      <span class="quiz-no">${index + 1}</span>
      <span class="quiz-subject">${escapeHtml(QUIZ_SUBJECTS[question.subject] || question.subject)}</span>
      <span class="quiz-origin">지문 ${String(question.number).padStart(2, '0')}</span>
      ${question.blanks.length > 1 ? `<span class="quiz-blank-count">빈칸 ${question.blanks.length}</span>` : ''}
      ${badges.join('')}
      ${extra}
    </div>`;
}

function renderQuizSolver(container) {
  const totalBlanks = countBlanks(quizSession.questions);
  const answered = Object.values(quizSession.answers).filter(Boolean).length;

  const questionsHtml = quizSession.questions.map((question, index) => `
    <li class="quiz-item ${question.blanks.length ? '' : 'is-reference'}">
      ${questionHead(question, index)}
      <p class="quiz-sentence">${renderQuestionBody(question, index, false)}</p>
    </li>
  `).join('');

  container.innerHTML = `
    <div class="quiz-toolbar">
      <div class="quiz-progress"><strong id="quizAnswered">${answered}</strong> / ${totalBlanks} 응답</div>
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
      const key = answerKey(Number(e.target.dataset.question), Number(e.target.dataset.segment));
      quizSession.answers[key] = e.target.value || null;
      e.target.classList.toggle('is-filled', Boolean(e.target.value));
      const counter = document.getElementById('quizAnswered');
      if (counter) counter.textContent = String(Object.values(quizSession.answers).filter(Boolean).length);
    });
    select.classList.toggle('is-filled', Boolean(select.value));
  });

  document.getElementById('quizSubmitBtn').addEventListener('click', () => submitQuiz());
  document.getElementById('quizSubmitBottomBtn').addEventListener('click', () => submitQuiz());
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
    const wrongBlanks = question.blanks.filter(
      blank => quizSession.answers[answerKey(index, blank.segmentIndex)] !== blank.answer
    );
    const state = !question.blanks.length ? 'is-reference' : wrongBlanks.length ? 'is-wrong' : 'is-correct';
    const mark = !question.blanks.length
      ? '원문'
      : wrongBlanks.length
        ? `오답 ${wrongBlanks.length}`
        : '정답';

    const answerLines = wrongBlanks.map(blank => `
      <p class="quiz-answer-line">
        <span class="quiz-answer-label">원문</span>
        <span class="quiz-answer-text">${escapeHtml(blank.answer)}</span>
        <span class="quiz-mutation">${escapeHtml(blank.mutationType)}</span>
      </p>`).join('');

    return `
      <li class="quiz-item ${state}">
        ${questionHead(question, index, `<span class="quiz-mark">${mark}</span>`)}
        <p class="quiz-sentence">${renderQuestionBody(question, index, true)}</p>
        ${answerLines}
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
        <div>정답률 <strong>${result.total ? Math.round((result.correct / result.total) * 100) : 0}%</strong></div>
        ${result.referenceCount ? `<div class="quiz-ref-note">원문 그대로 제시된 <strong>${result.referenceCount}지문</strong>은 채점에서 제외했습니다.</div>` : ''}
        ${result.reviewAdded ? `<div class="quiz-ref-note">틀린 <strong>${result.reviewAdded}개</strong>를 복습 대기에 담았습니다.</div>` : ''}
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
    answers: {},
    startedAt: Date.now(),
    result: null
  };
  renderQuiz();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function submitQuiz() {
  if (!quizSession || quizSession.result) return;

  const totalBlanks = countBlanks(quizSession.questions);
  const answered = Object.values(quizSession.answers).filter(Boolean).length;
  const unanswered = totalBlanks - answered;
  if (unanswered > 0 && !confirm(`미응답 ${unanswered}개가 있습니다. 그대로 제출할까요?`)) return;

  const progress = loadProgress();
  const review = new Set(progress.review);
  const bySubject = {};
  let correct = 0;
  let referenceCount = 0;
  let reviewAdded = 0;

  quizSession.questions.forEach((question, index) => {
    if (!question.blanks.length) {
      referenceCount++;
      return;
    }
    const stat = bySubject[question.subject] || (bySubject[question.subject] = { correct: 0, total: 0 });
    question.blanks.forEach(blank => {
      const entry = `${question.key}#${blank.segmentIndex}`;
      const ok = quizSession.answers[answerKey(index, blank.segmentIndex)] === blank.answer;
      stat.total++;
      if (ok) {
        correct++;
        stat.correct++;
        review.delete(entry);      // 맞혔으면 복습 대기에서 뺀다
      } else if (!review.has(entry)) {
        review.add(entry);
        reviewAdded++;
      }
    });
  });

  progress.review = [...review];
  saveProgress(progress);

  const elapsedSeconds = Math.round((Date.now() - quizSession.startedAt) / 1000);

  quizSession.result = {
    correct,
    total: totalBlanks,
    bySubject,
    referenceCount,
    reviewAdded,
    elapsed: formatClock(elapsedSeconds)
  };

  saveQuizRecord({
    date: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }),
    correct,
    total: totalBlanks,
    elapsed: quizSession.result.elapsed
  });

  renderQuiz();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function abortQuiz() {
  if (!confirm('현재 퀴즈를 그만두고 처음 화면으로 돌아갈까요?')) return;
  quizSession = null;
  renderQuiz();
}

export function initQuiz() {
  renderQuiz();
}
