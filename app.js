import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// ===== Firebase 설정 =====

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ===== 데이터 설정 =====
const SUBJECTS = [
  '부동산학개론', '민법', '공인중개사법 및 실무',
  '부동산공시법', '부동산세법', '부동산공법'
];

const TAB_NAMES = ['기본이론', '핵심요약', '기출문제', '예상문제', '동형모의', '적중100선'];

const TAB_CONFIG = {
  '기본이론': { '부동산학개론': 52, '민법': 50, '공인중개사법 및 실무': 40, '부동산공시법': 40, '부동산세법': 40, '부동산공법': 49 },
  '핵심요약': { '부동산학개론': 36, '민법': 36, '공인중개사법 및 실무': 32, '부동산공시법': 32, '부동산세법': 32, '부동산공법': 32 },
  '기출문제': null,
  '예상문제': null,
  '동형모의': null,
  '적중100선': null
};

const MIN_MONTH = 2;
const MAX_MONTH = 9;
const YEAR = 2026;
const EXAM_INDEX_PATH = './assets/exams/exam-index.json';

// ===== 상태 =====
let currentTab = '기본이론';
let currentMonth = new Date().getMonth();
let selectedDate = null;
let modalTab = '기본이론';

if (currentMonth < MIN_MONTH) currentMonth = MIN_MONTH;
if (currentMonth > MAX_MONTH) currentMonth = MAX_MONTH;

// ===== 기기 코드 =====
function generateCode() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

function getDeviceCode() {
  let code = localStorage.getItem('deviceCode');
  if (!code) {
    code = generateCode();
    localStorage.setItem('deviceCode', code);
  }
  return code;
}

let deviceCode = getDeviceCode();

// ===== 인메모리 캐시 =====
let cachedData = {};
let cachedGoalDates = {};
let cachedExamResults = [];

// ===== 기출문제 풀이 상태 =====
let examIndex = [];
let selectedExamPart = 1;
let selectedExamId = null;
let currentExam = null;
let currentAttempt = null;
let examTimerId = null;
let suppressReviewExpansionAnimation = false;
let selectedExamHistoryId = null;
let selectedExamHistoryQuestion = null;
let suppressHistoryExpansionAnimation = false;

function getExamResultsStorageKey() {
  return `examResults:${deviceCode}`;
}

// ===== 클라우드 동기화 =====
async function loadFromCloud() {
  try {
    const ref = doc(db, 'users', deviceCode);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      cachedData = d.calendarData || {};
      cachedGoalDates = d.goalDates || {};
      const rawExamResults = localStorage.getItem(getExamResultsStorageKey()) || localStorage.getItem('examResults');
      cachedExamResults = d.examResults || (rawExamResults ? JSON.parse(rawExamResults) : []);
      if (!d.examResults && rawExamResults) await saveToCloud();
    } else {
      // 처음 접속: 기존 localStorage 데이터 마이그레이션
      const raw = localStorage.getItem('calendarData');
      if (raw) cachedData = JSON.parse(raw);
      const rawGoal = localStorage.getItem('goalDates');
      if (rawGoal) cachedGoalDates = JSON.parse(rawGoal);
      const rawExamResults = localStorage.getItem(getExamResultsStorageKey()) || localStorage.getItem('examResults');
      if (rawExamResults) cachedExamResults = JSON.parse(rawExamResults);
      if (raw || rawGoal || rawExamResults) await saveToCloud();
    }
  } catch (e) {
    console.error('클라우드 로드 실패, 로컬 데이터 사용:', e);
    const raw = localStorage.getItem('calendarData');
    cachedData = raw ? JSON.parse(raw) : {};
    const rawGoal = localStorage.getItem('goalDates');
    cachedGoalDates = rawGoal ? JSON.parse(rawGoal) : {};
    const rawExamResults = localStorage.getItem(getExamResultsStorageKey()) || localStorage.getItem('examResults');
    cachedExamResults = rawExamResults ? JSON.parse(rawExamResults) : [];
  }
}

async function saveToCloud() {
  try {
    const ref = doc(db, 'users', deviceCode);
    await setDoc(ref, {
      calendarData: cachedData,
      goalDates: cachedGoalDates,
      examResults: cachedExamResults,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('클라우드 저장 실패:', e);
  }
}

// ===== 데이터 접근 (기존 인터페이스 유지) =====
function loadData() {
  return cachedData;
}

function saveData(data) {
  cachedData = data;
  saveToCloud();
}

function loadGoalDates() {
  return cachedGoalDates;
}

function saveGoalDates(dates) {
  cachedGoalDates = dates;
  saveToCloud();
}

function loadExamResults() {
  return cachedExamResults;
}

function saveExamResults(results) {
  cachedExamResults = results;
  localStorage.setItem(getExamResultsStorageKey(), JSON.stringify(cachedExamResults));
  saveToCloud();
}

// ===== 기기 코드 UI =====
function renderDeviceCode() {
  const el = document.getElementById('deviceCodeSection');
  const display = deviceCode.slice(0, 4) + '-' + deviceCode.slice(4);

  el.innerHTML = `
    <div class="device-code-bar">
      <span class="device-code-label">내 기기 코드</span>
      <span class="device-code-value">${display}</span>
      <button class="device-code-btn" id="copyCodeBtn">복사</button>
      <button class="device-code-btn secondary" id="changeCodeBtn">다른 기기 코드 입력</button>
    </div>
  `;

  document.getElementById('copyCodeBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(deviceCode).then(() => {
      const btn = document.getElementById('copyCodeBtn');
      btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = '복사'; }, 1500);
    });
  });

  document.getElementById('changeCodeBtn').addEventListener('click', () => {
    el.innerHTML = `
      <div class="device-code-bar">
        <span class="device-code-label">다른 기기 코드 입력</span>
        <input type="text" id="codeInput" class="code-input" placeholder="XXXX-XXXX" maxlength="9">
        <button class="device-code-btn" id="applyCodeBtn">적용</button>
        <button class="device-code-btn secondary" id="cancelCodeBtn">취소</button>
      </div>
    `;

    document.getElementById('codeInput').addEventListener('input', (e) => {
      let val = e.target.value.replace(/[^A-Z0-9a-z]/gi, '').toUpperCase();
      if (val.length > 4) val = val.slice(0, 4) + '-' + val.slice(4, 8);
      e.target.value = val;
    });

    document.getElementById('applyCodeBtn').addEventListener('click', async () => {
      const input = document.getElementById('codeInput').value.replace('-', '').toUpperCase();
      if (input.length !== 8) {
        alert('코드는 8자리여야 합니다 (예: ABCD-1234)');
        return;
      }
      localStorage.setItem('deviceCode', input);
      deviceCode = input;
      await loadFromCloud();
      renderDeviceCode();
      renderCalendar();
      renderProgress();
      renderExamHistory();
    });

    document.getElementById('cancelCodeBtn').addEventListener('click', renderDeviceCode);
  });
}

// ===== 수강 합산 =====
function getTotalByTab(tabName) {
  const data = loadData();
  const totals = {};
  SUBJECTS.forEach(s => totals[s] = 0);

  Object.values(data).forEach(dayData => {
    if (dayData[tabName]) {
      Object.entries(dayData[tabName]).forEach(([subject, count]) => {
        totals[subject] = (totals[subject] || 0) + count;
      });
    }
  });

  return totals;
}

// ===== 진행 현황 렌더링 =====
function renderTabs() {
  const tabBar = document.getElementById('tabBar');
  tabBar.innerHTML = TAB_NAMES.map(name =>
    `<button class="tab-btn ${name === currentTab ? 'active' : ''}" data-tab="${name}">${name}</button>`
  ).join('');

  tabBar.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      renderTabs();
      renderProgress();
    });
  });
}

function renderProgress() {
  const content = document.getElementById('progressContent');
  const config = TAB_CONFIG[currentTab];

  if (!config) {
    content.innerHTML = '<div class="progress-placeholder">준비 중입니다</div>';
    renderGoalSection();
    return;
  }

  const totals = getTotalByTab(currentTab);

  content.innerHTML = SUBJECTS.map((subject, i) => {
    const total = config[subject] || 0;
    const done = Math.min(totals[subject] || 0, total);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return `
      <div class="progress-row">
        <span class="progress-label">${subject}</span>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill color-${i}" style="width: ${pct}%"></div>
        </div>
        <span class="progress-text">${done} / ${total}강</span>
      </div>
    `;
  }).join('');

  renderGoalSection();
}

// ===== 완강 목표 계산기 =====
function renderGoalSection() {
  const container = document.getElementById('goalSection');
  const config = TAB_CONFIG[currentTab];

  if (!config) {
    container.innerHTML = '';
    return;
  }

  const goalDates = loadGoalDates();
  const savedDate = goalDates[currentTab] || '';

  let resultsHtml = '';

  if (savedDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(savedDate + 'T00:00:00');
    const daysLeft = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    const totals = getTotalByTab(currentTab);

    if (daysLeft <= 0) {
      resultsHtml = '<div class="goal-placeholder">목표 날짜가 지났습니다</div>';
    } else {
      let totalRemaining = 0;

      resultsHtml = SUBJECTS.map(subject => {
        const total = config[subject] || 0;
        const done = Math.min(totals[subject] || 0, total);
        const remaining = total - done;
        totalRemaining += Math.max(remaining, 0);

        if (remaining <= 0) {
          return `
            <div class="goal-row">
              <span class="goal-label">${subject}</span>
              <span class="goal-value">완강!</span>
            </div>
          `;
        }

        const perDay = remaining / daysLeft;
        const colorClass = perDay > 5 ? 'danger' : perDay > 3 ? 'warn' : '';

        return `
          <div class="goal-row">
            <span class="goal-label">${subject}</span>
            <span class="goal-value ${colorClass}">하루 ${perDay.toFixed(1)}강</span>
            <span class="goal-detail">(남은 ${remaining}강 / ${daysLeft}일)</span>
          </div>
        `;
      }).join('');

      const totalPerDay = totalRemaining / daysLeft;
      const totalColorClass = totalPerDay > 20 ? 'danger' : totalPerDay > 10 ? 'warn' : '';
      resultsHtml += `
        <div class="goal-total">
          <span class="goal-label">전체 합계</span>
          <span class="goal-value ${totalColorClass}">하루 ${totalPerDay.toFixed(1)}강</span>
          <span class="goal-detail">(남은 ${totalRemaining}강 / ${daysLeft}일)</span>
        </div>
      `;
    }
  }

  container.innerHTML = `
    <div class="goal-header">
      <span>완강 목표일</span>
      <input type="date" id="goalDateInput" value="${savedDate}"
        min="${YEAR}-03-01" max="${YEAR}-10-31">
    </div>
    <div class="goal-results">
      ${savedDate ? resultsHtml : '<div class="goal-placeholder">목표 날짜를 설정하면 하루 평균 수강량을 계산합니다</div>'}
    </div>
  `;

  document.getElementById('goalDateInput').addEventListener('change', (e) => {
    const dates = loadGoalDates();
    if (e.target.value) {
      dates[currentTab] = e.target.value;
    } else {
      delete dates[currentTab];
    }
    saveGoalDates(dates);
    renderGoalSection();
  });
}

// ===== 기출문제 풀이 =====
function getExamAttemptKey(examId) {
  return `examAttempt:${examId}`;
}

function createExamAttempt(exam) {
  return {
    examId: exam.examId,
    answers: {},
    currentQuestion: 1,
    elapsedMs: 0,
    isRunning: true,
    runningSince: Date.now(),
    submittedAt: null,
    result: null,
    reviewQuestion: null
  };
}

function loadExamAttempt(examId) {
  const raw = localStorage.getItem(getExamAttemptKey(examId));
  if (!raw) return null;
  try {
    const attempt = JSON.parse(raw);
    if (attempt.isRunning && attempt.runningSince) {
      attempt.elapsedMs += Date.now() - attempt.runningSince;
      attempt.runningSince = Date.now();
      saveExamAttempt(attempt);
    }
    return attempt;
  } catch (e) {
    console.error('기출문제 풀이 상태 로드 실패:', e);
    return null;
  }
}

function saveExamAttempt(attempt = currentAttempt) {
  if (!attempt?.examId) return;
  localStorage.setItem(getExamAttemptKey(attempt.examId), JSON.stringify(attempt));
}

function getElapsedMs(attempt = currentAttempt) {
  if (!attempt) return 0;
  const runningDelta = attempt.isRunning && attempt.runningSince
    ? Date.now() - attempt.runningSince
    : 0;
  return attempt.elapsedMs + runningDelta;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
}

async function loadExamIndex() {
  try {
    const res = await fetch(EXAM_INDEX_PATH, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    examIndex = data.exams || [];
    selectedExamId = examIndex.find(exam => exam.part === selectedExamPart)?.examId || null;
  } catch (e) {
    console.error('기출문제 목록 로드 실패:', e);
    examIndex = [];
  }
}

async function loadExam(examId) {
  const meta = examIndex.find(exam => exam.examId === examId);
  if (!meta) return null;
  const res = await fetch(meta.dataPath, { cache: 'no-store' });
  if (!res.ok) throw new Error(`기출문제 데이터 로드 실패: HTTP ${res.status}`);
  return res.json();
}

function getAvailableExamsForPart(part) {
  return examIndex
    .filter(exam => exam.part === part && exam.status === 'available')
    .sort((a, b) => b.year - a.year || b.round - a.round);
}

function renderExamPractice() {
  const container = document.getElementById('examPractice');
  if (!container) return;

  const availableExams = getAvailableExamsForPart(selectedExamPart);
  const examOptions = availableExams.map(exam => `
    <option value="${exam.examId}" ${exam.examId === selectedExamId ? 'selected' : ''}>
      ${exam.year}년 ${exam.round}회 (${exam.questionCount}문항)
    </option>
  `).join('');

  container.innerHTML = `
    <div class="exam-picker">
      <div class="exam-field">
        <label for="examPartSelect">시험 구분</label>
        <select id="examPartSelect">
          <option value="1" ${selectedExamPart === 1 ? 'selected' : ''}>1차</option>
          <option value="2" ${selectedExamPart === 2 ? 'selected' : ''}>2차</option>
        </select>
      </div>
      <div class="exam-field">
        <label for="examRoundSelect">연도/회차</label>
        <select id="examRoundSelect" ${availableExams.length ? '' : 'disabled'}>
          ${examOptions || '<option>준비 중</option>'}
        </select>
      </div>
      <button class="btn btn-confirm" id="examStartBtn" ${selectedExamId ? '' : 'disabled'}>시험 시작</button>
    </div>
    <div class="exam-workspace" id="examWorkspace"></div>
  `;

  document.getElementById('examPartSelect').addEventListener('change', (e) => {
    selectedExamPart = parseInt(e.target.value);
    selectedExamId = getAvailableExamsForPart(selectedExamPart)[0]?.examId || null;
    currentExam = null;
    currentAttempt = null;
    stopExamTicker();
    renderExamPractice();
    renderExamWorkspace();
  });

  document.getElementById('examRoundSelect').addEventListener('change', (e) => {
    selectedExamId = e.target.value;
    currentExam = null;
    currentAttempt = null;
    stopExamTicker();
    renderExamWorkspace();
  });

  document.getElementById('examStartBtn').addEventListener('click', startSelectedExam);
  renderExamWorkspace();
}

async function startSelectedExam() {
  if (!selectedExamId) return;
  try {
    currentExam = await loadExam(selectedExamId);
    currentAttempt = loadExamAttempt(selectedExamId) || createExamAttempt(currentExam);
    if (!currentAttempt.submittedAt) {
      startStopwatch();
    }
    saveExamAttempt();
    renderExamWorkspace();
  } catch (e) {
    console.error(e);
    alert('기출문제 데이터를 불러오지 못했습니다. 로컬 서버에서 실행 중인지 확인해 주세요.');
  }
}

function renderExamWorkspace() {
  const workspace = document.getElementById('examWorkspace');
  if (!workspace) return;

  if (!examIndex.length) {
    workspace.innerHTML = '<div class="exam-empty">기출문제 목록을 불러오지 못했습니다.</div>';
    return;
  }

  if (!selectedExamId) {
    workspace.innerHTML = '<div class="exam-empty">현재 MVP는 2024년 1차 시험부터 지원합니다.</div>';
    return;
  }

  if (!currentExam || !currentAttempt) {
    workspace.innerHTML = '<div class="exam-empty">시험 시작을 누르면 풀이 시간이 자동으로 측정됩니다.</div>';
    return;
  }

  if (currentAttempt.result) {
    renderExamResult(workspace);
    return;
  }

  renderExamSolver(workspace);
}

function renderExamSolver(workspace) {
  const question = currentExam.questions[currentAttempt.currentQuestion - 1];
  const selectedAnswer = currentAttempt.answers[question.number];
  const unanswered = currentExam.questions.filter(q => !currentAttempt.answers[q.number]).length;
  const elapsed = formatDuration(getElapsedMs());

  workspace.innerHTML = `
    <div class="exam-toolbar">
      <div>
        <div class="exam-title">${currentExam.year}년 ${currentExam.round}회 ${currentExam.part}차</div>
        <div class="exam-subtitle">${question.number} / ${currentExam.questionCount}번 · 미응답 ${unanswered}문항</div>
      </div>
      <div class="exam-timer" id="examTimer">${elapsed}</div>
      <div class="exam-actions">
        <button class="exam-small-btn" id="examPauseBtn">${currentAttempt.isRunning ? '일시정지' : '재개'}</button>
        <button class="exam-small-btn" id="examResetBtn">초기화</button>
      </div>
    </div>
    <div class="question-layout">
      <div class="question-card">
        <img class="question-image" src="${question.imagePath}" alt="${question.number}번 문제">
      </div>
      <div class="answer-panel">
        <div class="answer-label">답안 선택</div>
        <div class="answer-buttons">
          ${[1, 2, 3, 4, 5].map(value => `
            <button class="answer-btn ${selectedAnswer === value ? 'selected' : ''}" data-answer="${value}">
              ${value}
            </button>
          `).join('')}
        </div>
        <div class="question-nav">
          <button class="btn btn-cancel" id="prevQuestionBtn" ${question.number <= 1 ? 'disabled' : ''}>이전</button>
          <button class="btn btn-cancel" id="nextQuestionBtn" ${question.number >= currentExam.questionCount ? 'disabled' : ''}>다음</button>
        </div>
        <button class="btn btn-confirm submit-exam-btn" id="submitExamBtn">제출 및 채점</button>
      </div>
    </div>
    <div class="question-map">
      ${currentExam.questions.map(q => {
        const status = currentAttempt.answers[q.number] ? 'answered' : 'unanswered';
        const current = q.number === question.number ? 'current' : '';
        return `<button class="question-dot ${status} ${current}" data-question="${q.number}">${q.number}</button>`;
      }).join('')}
    </div>
  `;

  workspace.querySelectorAll('.answer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentAttempt.answers[question.number] = parseInt(btn.dataset.answer);
      saveExamAttempt();
      renderExamWorkspace();
    });
  });

  workspace.querySelectorAll('.question-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      currentAttempt.currentQuestion = parseInt(btn.dataset.question);
      saveExamAttempt();
      renderExamWorkspace();
    });
  });

  document.getElementById('prevQuestionBtn').addEventListener('click', () => moveQuestion(-1));
  document.getElementById('nextQuestionBtn').addEventListener('click', () => moveQuestion(1));
  document.getElementById('examPauseBtn').addEventListener('click', toggleStopwatch);
  document.getElementById('examResetBtn').addEventListener('click', resetExamAttempt);
  document.getElementById('submitExamBtn').addEventListener('click', submitExam);
}

function moveQuestion(delta) {
  currentAttempt.currentQuestion = Math.min(
    currentExam.questionCount,
    Math.max(1, currentAttempt.currentQuestion + delta)
  );
  saveExamAttempt();
  renderExamWorkspace();
}

function startStopwatch() {
  if (!currentAttempt || currentAttempt.submittedAt) return;
  if (!currentAttempt.isRunning) {
    currentAttempt.isRunning = true;
    currentAttempt.runningSince = Date.now();
  }
  saveExamAttempt();
  startExamTicker();
}

function pauseStopwatch() {
  if (!currentAttempt?.isRunning) return;
  currentAttempt.elapsedMs = getElapsedMs();
  currentAttempt.isRunning = false;
  currentAttempt.runningSince = null;
  saveExamAttempt();
  stopExamTicker();
}

function toggleStopwatch() {
  if (currentAttempt.isRunning) {
    pauseStopwatch();
  } else {
    startStopwatch();
  }
  renderExamWorkspace();
}

function startExamTicker() {
  stopExamTicker();
  examTimerId = setInterval(() => {
    const timer = document.getElementById('examTimer');
    if (timer) timer.textContent = formatDuration(getElapsedMs());
    if (currentAttempt) saveExamAttempt();
  }, 1000);
}

function stopExamTicker() {
  if (examTimerId) {
    clearInterval(examTimerId);
    examTimerId = null;
  }
}

function resetExamAttempt() {
  if (!currentExam) return;
  if (!confirm('현재 풀이 기록을 초기화할까요?')) return;
  currentAttempt = createExamAttempt(currentExam);
  saveExamAttempt();
  startStopwatch();
  renderExamWorkspace();
}

function submitExam() {
  const unanswered = currentExam.questions.filter(q => !currentAttempt.answers[q.number]).length;
  if (unanswered > 0 && !confirm(`미응답 ${unanswered}문항이 있습니다. 그대로 제출할까요?`)) return;

  currentAttempt.elapsedMs = getElapsedMs();
  currentAttempt.isRunning = false;
  currentAttempt.runningSince = null;
  currentAttempt.submittedAt = new Date().toISOString();
  currentAttempt.result = gradeExam(currentExam, currentAttempt);
  recordExamResult(currentExam, currentAttempt);
  saveExamAttempt();
  stopExamTicker();
  renderExamWorkspace();
  renderExamHistory();
}

function formatScore(score) {
  return Number.isInteger(score) ? `${score}점` : `${score.toFixed(1)}점`;
}

function getRangeScore(questionResults, start, end, point = 2.5) {
  const items = questionResults.filter(item => item.number >= start && item.number <= end);
  const correctCount = items.filter(item => item.correct).length;
  return {
    start,
    end,
    correctCount,
    totalCount: items.length,
    score: correctCount * point
  };
}

function getPart2DetailedScores(questionResults, point = 2.5) {
  return [
    { label: '공시법', name: '부동산공시법', ...getRangeScore(questionResults, 81, 104, point) },
    { label: '세법', name: '부동산세법', ...getRangeScore(questionResults, 105, 120, point) }
  ];
}

function getSubjectBreakdowns(part, subject, questionResults, point = 2.5) {
  if (subject.breakdowns) return subject.breakdowns;
  if (part === 2 && subject.start === 81 && subject.end === 120) {
    return getPart2DetailedScores(questionResults, point);
  }
  return [];
}

function getHistoryScoreItems(record) {
  const result = record.result;
  const point = 2.5;

  if (record.part === 1) {
    const first = result.subjects.find(subject => subject.start === 1);
    const second = result.subjects.find(subject => subject.start === 41);
    return [
      { label: '학개론', score: first?.score || 0 },
      { label: '민법', score: second?.score || 0 }
    ];
  }

  const broker = result.subjects.find(subject => subject.start === 1);
  const publicLaw = result.subjects.find(subject => subject.start === 41);
  const detailed = getPart2DetailedScores(result.questions, point);
  return [
    { label: '중개사법', score: broker?.score || 0 },
    { label: '공법', score: publicLaw?.score || 0 },
    ...detailed
  ];
}

function gradeExam(exam, attempt) {
  const point = exam.pointPerQuestion || 2.5;
  const questionResults = exam.questions.map(question => {
    const selected = attempt.answers[question.number] || null;
    return {
      number: question.number,
      selected,
      answer: question.answer,
      correct: selected === question.answer
    };
  });

  const subjectResults = exam.subjects.map(subject => {
    const items = questionResults.filter(item => item.number >= subject.start && item.number <= subject.end);
    const correctCount = items.filter(item => item.correct).length;
    const totalCount = items.length;
    const score = correctCount * point;
    return {
      ...subject,
      correctCount,
      totalCount,
      score,
      breakdowns: getSubjectBreakdowns(exam.part, subject, questionResults, point),
      failedBySubject: score < 40
    };
  });

  const averageScore = subjectResults.reduce((sum, subject) => sum + subject.score, 0) / subjectResults.length;
  const hasSubjectFail = subjectResults.some(subject => subject.failedBySubject);

  return {
    passed: !hasSubjectFail && averageScore >= 60,
    averageScore,
    hasSubjectFail,
    elapsedMs: attempt.elapsedMs,
    subjects: subjectResults,
    questions: questionResults
  };
}

function createExamResultRecord(exam, attempt) {
  const submittedAt = attempt.submittedAt || new Date().toISOString();
  return {
    id: `${exam.examId}:${submittedAt}`,
    deviceCode,
    examId: exam.examId,
    year: exam.year,
    round: exam.round,
    part: exam.part,
    questionCount: exam.questionCount,
    submittedAt,
    elapsedMs: attempt.elapsedMs,
    answers: { ...attempt.answers },
    result: attempt.result
  };
}

function recordExamResult(exam, attempt) {
  const record = createExamResultRecord(exam, attempt);
  const results = loadExamResults().filter(item => item.id !== record.id);
  results.unshift(record);
  saveExamResults(results);
  selectedExamHistoryId = null;
  selectedExamHistoryQuestion = null;
}

function renderExamResult(workspace) {
  const result = currentAttempt.result;
  const wrongCount = result.questions.filter(q => !q.correct).length;
  const selectedReviewNumber = currentAttempt.reviewQuestion;
  const selectedReviewItem = result.questions.find(item => item.number === selectedReviewNumber);
  const selectedReviewQuestion = currentExam.questions.find(question => question.number === selectedReviewNumber);
  const selectedReviewRow = selectedReviewNumber ? Math.floor((selectedReviewNumber - 1) / 10) : null;
  const reviewRows = [];
  for (let i = 0; i < result.questions.length; i += 10) {
    reviewRows.push(result.questions.slice(i, i + 10));
  }

  workspace.innerHTML = `
    <div class="result-summary ${result.passed ? 'pass' : 'fail'}">
      <div>
        <div class="result-status">${result.passed ? '합격' : '불합격'}</div>
        <div class="result-meta">전 과목 평균 ${result.averageScore.toFixed(1)}점 · 총 풀이 시간 ${formatDuration(result.elapsedMs)}</div>
      </div>
      <button class="btn btn-cancel" id="reviewResetBtn">다시 풀기</button>
    </div>
    <div class="result-subjects">
      ${result.subjects.map(subject => `
        <div class="result-subject ${subject.failedBySubject ? 'subject-fail' : ''}">
          <div class="result-subject-name">${subject.name}</div>
          <div class="result-subject-score">${formatScore(subject.score)}</div>
          <div class="result-subject-detail">
            ${subject.correctCount} / ${subject.totalCount}문항 정답
            ${subject.failedBySubject ? '<span class="fail-badge">과락</span>' : ''}
          </div>
          ${getSubjectBreakdowns(currentExam.part, subject, result.questions).length ? `
            <div class="result-breakdowns">
              ${getSubjectBreakdowns(currentExam.part, subject, result.questions).map(item => `
                <div class="result-breakdown-row">
                  <span>${item.name}</span>
                  <strong>${formatScore(item.score)}</strong>
                  <small>${item.correctCount} / ${item.totalCount}</small>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
    <div class="question-review">
      <div class="review-header">문제별 정오답 · 오답/미응답 ${wrongCount}문항</div>
      <div class="review-list">
        ${reviewRows.map((row, rowIndex) => `
          <div class="review-grid">
            ${row.map(item => `
              <button class="review-dot ${item.correct ? 'correct' : 'wrong'} ${item.number === selectedReviewNumber ? 'selected' : ''}" data-question="${item.number}">
                <span>${item.number}</span>
                <small>${item.selected || '-'} / ${item.answer}</small>
              </button>
            `).join('')}
          </div>
          ${rowIndex === selectedReviewRow && selectedReviewItem && selectedReviewQuestion ? `
            <div class="review-expanded ${suppressReviewExpansionAnimation ? 'no-animation' : ''}" data-review-expanded-row="${rowIndex}">
              <div class="review-expanded-head">
                <div>
                  <div class="review-expanded-title">${selectedReviewNumber}번 문제</div>
                  <div class="review-expanded-meta">
                    선택 ${selectedReviewItem.selected || '-'} · 정답 ${selectedReviewItem.answer}
                  </div>
                </div>
                <span class="review-result-badge ${selectedReviewItem.correct ? 'correct' : 'wrong'}">
                  ${selectedReviewItem.correct ? '정답' : '오답'}
                </span>
              </div>
              <div class="review-question-card">
                <img class="review-question-image" src="${selectedReviewQuestion.imagePath}" alt="${selectedReviewNumber}번 문제">
              </div>
            </div>
          ` : ''}
        `).join('')}
      </div>
    </div>
  `;

  suppressReviewExpansionAnimation = false;

  document.getElementById('reviewResetBtn').addEventListener('click', resetExamAttempt);
  workspace.querySelectorAll('.review-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextQuestion = parseInt(btn.dataset.question);
      const previousQuestion = currentAttempt.reviewQuestion;
      const previousRow = previousQuestion ? Math.floor((previousQuestion - 1) / 10) : null;
      const nextRow = Math.floor((nextQuestion - 1) / 10);
      suppressReviewExpansionAnimation = previousRow === nextRow;
      currentAttempt.reviewQuestion = nextQuestion;
      saveExamAttempt();
      renderExamWorkspace();
    });
  });
}

function formatSubmittedAt(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString || '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}`;
}

function getHistoryQuestionImagePath(record, questionNumber) {
  return `./assets/exams/${record.examId}/q${String(questionNumber).padStart(3, '0')}.png`;
}

function renderExamHistory() {
  const container = document.getElementById('examHistory');
  if (!container) return;

  const results = loadExamResults()
    .slice()
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  if (!results.length) {
    container.innerHTML = '<div class="exam-empty">아직 저장된 기출문제 풀이 결과가 없습니다.</div>';
    return;
  }

  container.innerHTML = `
    <div class="history-device-note">기기 코드 ${deviceCode.slice(0, 4)}-${deviceCode.slice(4)} 기준으로 저장된 결과입니다.</div>
    <div class="history-list">
      ${results.map(record => {
        const result = record.result;
        const isOpen = record.id === selectedExamHistoryId;
        const wrongCount = result.questions.filter(item => !item.correct).length;
        const selectedNumber = isOpen && selectedExamHistoryQuestion?.recordId === record.id
          ? selectedExamHistoryQuestion.questionNumber
          : null;
        const selectedItem = selectedNumber
          ? result.questions.find(item => item.number === selectedNumber && !item.correct)
          : null;
        const selectedRow = selectedItem ? Math.floor((selectedItem.number - 1) / 10) : null;
        const historyRows = [];
        for (let i = 0; i < result.questions.length; i += 10) {
          historyRows.push(result.questions.slice(i, i + 10));
        }
        const historyScoreItems = getHistoryScoreItems(record);
        return `
          <div class="history-item ${isOpen ? 'open' : ''}">
            <div class="history-row-head">
              <button class="history-summary" data-history-id="${record.id}">
                <div>
                  <div class="history-title">${record.year}년 ${record.round}회 ${record.part}차</div>
                  <div class="history-meta">${formatSubmittedAt(record.submittedAt)} · ${formatDuration(record.elapsedMs)}</div>
                </div>
                <div class="history-score">
                  <span class="history-pass ${result.passed ? 'pass' : 'fail'}">${result.passed ? '합격' : '불합격'}</span>
                  <div class="history-score-lines">
                    ${historyScoreItems.map(item => `
                      <span>${item.label}: ${formatScore(item.score)}</span>
                    `).join('')}
                  </div>
                </div>
              </button>
              <button class="history-delete-btn" data-history-id="${record.id}" aria-label="${record.year}년 ${record.round}회 ${record.part}차 기록 삭제">삭제</button>
            </div>
            ${isOpen ? `
              <div class="history-detail">
                <div class="history-subjects">
                  ${result.subjects.map(subject => `
                    <div class="history-subject ${subject.failedBySubject ? 'subject-fail' : ''}">
                      <span>${subject.name}</span>
                      <strong>${formatScore(subject.score)}</strong>
                      <small>${subject.correctCount} / ${subject.totalCount}문항${subject.failedBySubject ? ' · 과락' : ''}</small>
                      ${getSubjectBreakdowns(record.part, subject, result.questions).length ? `
                        <div class="history-sub-breakdowns">
                          ${getSubjectBreakdowns(record.part, subject, result.questions).map(item => `
                            <small>${item.name}: ${formatScore(item.score)} (${item.correctCount}/${item.totalCount})</small>
                          `).join('')}
                        </div>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
                <div class="history-review-head">문제별 정오답 · 오답/미응답 ${wrongCount}문항</div>
                <div class="history-review-list">
                  ${historyRows.map((row, rowIndex) => `
                    <div class="history-question-grid">
                      ${row.map(item => item.correct ? `
                        <div class="history-question correct">
                          <span>${item.number}</span>
                          <small>${item.selected || '-'} / ${item.answer}</small>
                        </div>
                      ` : `
                        <button class="history-question wrong ${item.number === selectedNumber ? 'selected' : ''}" data-history-question="${item.number}" data-history-id="${record.id}">
                          <span>${item.number}</span>
                          <small>${item.selected || '-'} / ${item.answer}</small>
                        </button>
                      `).join('')}
                    </div>
                    ${rowIndex === selectedRow && selectedItem ? `
                      <div class="history-expanded ${suppressHistoryExpansionAnimation ? 'no-animation' : ''}">
                        <div class="review-expanded-head">
                          <div>
                            <div class="review-expanded-title">${selectedItem.number}번 문제</div>
                            <div class="review-expanded-meta">선택 ${selectedItem.selected || '-'} · 정답 ${selectedItem.answer}</div>
                          </div>
                          <span class="review-result-badge wrong">오답</span>
                        </div>
                        <div class="review-question-card">
                          <img class="review-question-image" src="${getHistoryQuestionImagePath(record, selectedItem.number)}" alt="${selectedItem.number}번 문제">
                        </div>
                      </div>
                    ` : ''}
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  suppressHistoryExpansionAnimation = false;

  container.querySelectorAll('.history-summary').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextId = btn.dataset.historyId;
      selectedExamHistoryId = selectedExamHistoryId === nextId ? null : nextId;
      if (selectedExamHistoryId !== nextId) selectedExamHistoryQuestion = null;
      renderExamHistory();
    });
  });

  container.querySelectorAll('.history-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const recordId = btn.dataset.historyId;
      const record = loadExamResults().find(item => item.id === recordId);
      const label = record
        ? `${record.year}년 ${record.round}회 ${record.part}차`
        : '이 기록';
      if (!confirm(`${label} 풀이 기록을 삭제할까요?`)) return;

      saveExamResults(loadExamResults().filter(item => item.id !== recordId));
      if (selectedExamHistoryId === recordId) {
        selectedExamHistoryId = null;
        selectedExamHistoryQuestion = null;
      }
      renderExamHistory();
    });
  });

  container.querySelectorAll('.history-question.wrong').forEach(btn => {
    btn.addEventListener('click', () => {
      const recordId = btn.dataset.historyId;
      const nextQuestion = parseInt(btn.dataset.historyQuestion);
      const previousQuestion = selectedExamHistoryQuestion?.recordId === recordId
        ? selectedExamHistoryQuestion.questionNumber
        : null;
      const previousRow = previousQuestion ? Math.floor((previousQuestion - 1) / 10) : null;
      const nextRow = Math.floor((nextQuestion - 1) / 10);
      selectedExamHistoryId = recordId;
      selectedExamHistoryQuestion = { recordId, questionNumber: nextQuestion };
      suppressHistoryExpansionAnimation = previousRow === nextRow;
      renderExamHistory();
    });
  });
}

async function initExamPractice() {
  await loadExamIndex();
  renderExamPractice();
}

// ===== D-Day =====
const EXAM_DATE = new Date(YEAR, 9, 31);

function renderDDay() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((EXAM_DATE - today) / (1000 * 60 * 60 * 24));
  const el = document.getElementById('dDay');
  el.textContent = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${Math.abs(diff)}`;
}

// ===== 캘린더 렌더링 =====
function renderCalendar() {
  const title = document.getElementById('calendarTitle');
  title.textContent = `${YEAR}년 ${currentMonth + 1}월`;
  renderDDay();

  document.getElementById('prevMonth').disabled = currentMonth <= MIN_MONTH;
  document.getElementById('nextMonth').disabled = currentMonth >= MAX_MONTH;

  const daysContainer = document.getElementById('calendarDays');
  const firstDay = new Date(YEAR, currentMonth, 1).getDay();
  const daysInMonth = new Date(YEAR, currentMonth + 1, 0).getDate();

  const today = new Date();
  const todayStr = today.getFullYear() === YEAR && today.getMonth() === currentMonth
    ? today.getDate() : -1;

  const data = loadData();
  let html = '';

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="day-cell empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${YEAR}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = d === todayStr;
    const dayData = data[dateStr];

    let recordsHtml = '';
    if (dayData) {
      const entries = [];
      Object.entries(dayData).forEach(([tab, subjects]) => {
        Object.entries(subjects).forEach(([subj, count]) => {
          if (count > 0) {
            const shortName = subj.length > 4 ? subj.substring(0, 4) + '..' : subj;
            entries.push(`${shortName} ${count}`);
          }
        });
      });
      recordsHtml = entries.slice(0, 3).map(e =>
        `<div class="day-record">${e}</div>`
      ).join('');
      if (entries.length > 3) {
        recordsHtml += `<div class="day-record">+${entries.length - 3}개</div>`;
      }
    }

    html += `
      <div class="day-cell ${isToday ? 'today' : ''}" data-date="${dateStr}">
        <div class="day-number">${d}</div>
        <div class="day-records">${recordsHtml}</div>
      </div>
    `;
  }

  daysContainer.innerHTML = html;

  daysContainer.querySelectorAll('.day-cell:not(.empty)').forEach(cell => {
    cell.addEventListener('click', () => openModal(cell.dataset.date));
  });
}

// ===== 모달 =====
function openModal(dateStr) {
  selectedDate = dateStr;
  modalTab = '기본이론';

  const parts = dateStr.split('-');
  document.getElementById('modalTitle').textContent =
    `${parseInt(parts[1])}월 ${parseInt(parts[2])}일 수강 기록`;

  renderModalTabs();
  renderModalBody();
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  selectedDate = null;
}

function renderModalTabs() {
  const container = document.getElementById('modalTabs');
  container.innerHTML = TAB_NAMES.map(name =>
    `<button class="modal-tab-btn ${name === modalTab ? 'active' : ''}" data-tab="${name}">${name}</button>`
  ).join('');

  container.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modalTab = btn.dataset.tab;
      renderModalTabs();
      renderModalBody();
    });
  });
}

function renderModalBody() {
  const body = document.getElementById('modalBody');
  const config = TAB_CONFIG[modalTab];

  if (!config) {
    body.innerHTML = '<div class="progress-placeholder">이 탭은 아직 설정되지 않았습니다</div>';
    return;
  }

  const data = loadData();
  const dayData = data[selectedDate]?.[modalTab] || {};

  body.innerHTML = SUBJECTS.map(subject => {
    const val = dayData[subject] || 0;
    return `
      <div class="input-row">
        <label>${subject}</label>
        <input type="number" min="0" value="${val}" data-subject="${subject}">
        <span class="unit">강</span>
      </div>
    `;
  }).join('');
}

function saveModal() {
  if (!selectedDate) return;

  const data = loadData();
  if (!data[selectedDate]) data[selectedDate] = {};

  const inputs = document.querySelectorAll('#modalBody input[data-subject]');
  if (inputs.length === 0) {
    closeModal();
    return;
  }

  const tabData = {};
  let hasValue = false;
  inputs.forEach(input => {
    const val = parseInt(input.value) || 0;
    if (val > 0) {
      tabData[input.dataset.subject] = val;
      hasValue = true;
    }
  });

  if (hasValue) {
    data[selectedDate][modalTab] = tabData;
  } else {
    delete data[selectedDate][modalTab];
    if (Object.keys(data[selectedDate]).length === 0) {
      delete data[selectedDate];
    }
  }

  saveData(data);
  closeModal();
  renderCalendar();
  renderProgress();
}

// ===== 이벤트 바인딩 =====
document.getElementById('prevMonth').addEventListener('click', () => {
  if (currentMonth > MIN_MONTH) {
    currentMonth--;
    renderCalendar();
  }
});

document.getElementById('nextMonth').addEventListener('click', () => {
  if (currentMonth < MAX_MONTH) {
    currentMonth++;
    renderCalendar();
  }
});

document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('modalConfirm').addEventListener('click', saveModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ===== 세부계획서 (PDF.js) =====
let pdfDoc = null;
let pdfPage = 1;
let pdfTotal = 0;

function initPlanViewer() {
  const fab = document.getElementById('planFab');
  const overlay = document.getElementById('planOverlay');
  const closeBtn = document.getElementById('planClose');
  const prevBtn = document.getElementById('planPrevPage');
  const nextBtn = document.getElementById('planNextPage');
  const pageInfo = document.getElementById('planPageInfo');
  const canvas = document.getElementById('planCanvas');

  // eslint-disable-next-line no-undef
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  async function renderPage(num) {
    const page = await pdfDoc.getPage(num);
    const containerWidth = canvas.parentElement.clientWidth;
    const viewport = page.getViewport({ scale: 1 });
    const dpr = window.devicePixelRatio || 1;
    const scale = (containerWidth / viewport.width) * dpr;
    const scaled = page.getViewport({ scale });

    canvas.width = scaled.width;
    canvas.height = scaled.height;
    canvas.style.width = (scaled.width / dpr) + 'px';
    canvas.style.height = (scaled.height / dpr) + 'px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;

    pdfPage = num;
    pageInfo.textContent = `${num} / ${pdfTotal}`;
    prevBtn.disabled = num <= 1;
    nextBtn.disabled = num >= pdfTotal;
  }

  fab.addEventListener('click', async () => {
    overlay.classList.add('show');
    if (!pdfDoc) {
      pdfDoc = await pdfjsLib.getDocument('plan.pdf').promise;
      pdfTotal = pdfDoc.numPages;
    }
    renderPage(pdfPage);
  });

  closeBtn.addEventListener('click', () => overlay.classList.remove('show'));
  prevBtn.addEventListener('click', () => { if (pdfPage > 1) renderPage(pdfPage - 1); });
  nextBtn.addEventListener('click', () => { if (pdfPage < pdfTotal) renderPage(pdfPage + 1); });
}

// ===== 초기화 =====
async function init() {
  await loadFromCloud();
  renderDeviceCode();
  renderTabs();
  renderProgress();
  renderCalendar();
  await initExamPractice();
  renderExamHistory();
  initPlanViewer();
}

init();
