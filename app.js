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

// ===== 클라우드 동기화 =====
async function loadFromCloud() {
  try {
    const ref = doc(db, 'users', deviceCode);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      cachedData = d.calendarData || {};
      cachedGoalDates = d.goalDates || {};
    } else {
      // 처음 접속: 기존 localStorage 데이터 마이그레이션
      const raw = localStorage.getItem('calendarData');
      if (raw) cachedData = JSON.parse(raw);
      const rawGoal = localStorage.getItem('goalDates');
      if (rawGoal) cachedGoalDates = JSON.parse(rawGoal);
      if (raw || rawGoal) await saveToCloud();
    }
  } catch (e) {
    console.error('클라우드 로드 실패, 로컬 데이터 사용:', e);
    const raw = localStorage.getItem('calendarData');
    cachedData = raw ? JSON.parse(raw) : {};
    const rawGoal = localStorage.getItem('goalDates');
    cachedGoalDates = rawGoal ? JSON.parse(rawGoal) : {};
  }
}

async function saveToCloud() {
  try {
    const ref = doc(db, 'users', deviceCode);
    await setDoc(ref, {
      calendarData: cachedData,
      goalDates: cachedGoalDates,
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
  initPlanViewer();
}

init();
