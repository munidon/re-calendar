// 지문 변형(오답 선지 생성) 엔진
// 출제자가 실제로 쓰는 14가지 변형 유형을 규칙으로 구현한다.
// 주의: "이하 / 미만"은 실제 시험에서 건드리지 않는 조사이므로 절대 변형하지 않는다.

/* ── 유형 04·09 : 당사자 교환 / 닮은 개념 교환 (대칭 쌍 맞바꾸기) ── */
const SWAP_PAIRS = [
  // 당사자
  ['양도담보설정자', '양도담보권자'],
  ['저당권설정자', '저당권자'],
  ['전세권설정자', '전세권자'],
  ['소속공인중개사', '개업공인중개사'],
  ['등기권리자', '등기의무자'],
  ['가등기권리자', '가등기의무자'],
  ['직접점유자', '간접점유자'],
  ['피상속인', '상속인'],
  ['지상권자', '토지소유자'],
  ['매수청구권', '매도청구권'],
  ['위탁자', '수탁자'],
  ['신탁자', '수탁자'],
  ['수증자', '증여자'],
  ['임차인', '임대인'],
  ['매도인', '매수인'],
  ['양도인', '양수인'],
  ['채권자', '채무자'],
  ['요역지', '승역지'],
  ['원고', '피고'],
  // 닮은 개념
  ['균형의 원칙', '적합의 원칙'],
  ['내부수익률', '순현가'],
  ['부기등기', '주등기'],
  ['원시취득', '승계취득'],
  ['종합합산', '별도합산'],
  ['효력규정', '단속규정'],
  ['자주점유', '타주점유'],
  ['재건축사업', '재개발사업'],
  ['주택재건축', '주택재개발'],
  ['재건축', '재개발'],
  ['기타소득', '사업소득'],
  ['지방세', '국세'],
  ['취득세', '재산세'],
  ['유원지', '잡종지'],
  ['경계복원측량', '지적현황측량'],
  ['연금의 현가계수', '일시불의 현가계수'],
  ['감채기금계수', '저당상수'],
  ['표준편차', '변동계수']
];

/* ── 유형 05 : 행정기관 교환 ── */
const AGENCIES = [
  '국토교통부장관', '행정안전부장관', '시·도지사',
  '시장·군수·구청장', '시장·군수', '지적소관청', '등록관청'
];

/* ── 유형 06 : 서술어 뒤집기 (양방향, 긴 규칙 우선) ── */
const PREDICATES = [
  ['적용하지 아니한다', '적용한다'],
  ['적용되지 아니한다', '적용된다'],
  ['적용되지 않는다', '적용된다'],
  ['해당하지 아니한다', '해당한다'],
  ['해당하지 않는다', '해당한다'],
  ['성립하지 아니한다', '성립한다'],
  ['성립하지 않는다', '성립한다'],
  ['부담하지 않는다', '부담한다'],
  ['말소하지 않는다', '말소한다'],
  ['보지 아니한다', '본다'],
  ['할 수 있다', '할 수 없다'],
  ['될 수 있다', '될 수 없다'],
  ['받을 수 있다', '받을 수 없다'],
  ['볼 수 있다', '볼 수 없다'],
  ['수 있다', '수 없다'],
  ['하여야 한다', '할 수 있다'],
  ['해야 한다', '할 수 있다'],
  ['것은 아니다', '것이다'],
  ['안 된다', '된다', 'oneWay'],
  ['하지 아니한다', '한다'],
  ['하지 않는다', '한다'],
  ['되지 아니한다', '된다'],
  ['되지 않는다', '된다']
];

/* 위 규칙이 모두 빗나갔을 때만 쓰는 "문장 끝 긍정 → 부정" 치환 */
const TAIL_PREDICATES = [
  ['한다.', '하지 아니한다.'],
  ['된다.', '되지 아니한다.'],
  ['있다.', '없다.'],
  ['없다.', '있다.'],
  ['한다', '하지 아니한다'],
  ['된다', '되지 아니한다']
];

/* ── 유형 09 확장 : 민법·공법 빈출 개념/수식어 대칭쌍 ── */
const CONCEPTS = [
  ['취득시효', '소멸시효'],
  ['대항력', '우선변제권'],
  ['확정적', '유동적'],
  ['묵시적', '명시적'],
  ['제3자', '당사자'],
  ['대리인', '본인'],
  ['전부', '일부'],
  ['포함', '제외'],
  ['직접', '간접'],
  ['정당한', '부당한'],
  ['우월한', '열등한'],
  ['현저히 낮은', '현저히 높은'],
  ['높은', '낮은'],
  ['현재', '장래'],
  ['적법', '위법'],
  ['유효', '무효'],
  ['무효', '취소'],
  ['선의', '악의'],
  ['고의', '과실'],
  ['해지', '해제'],
  ['갱신', '종료'],
  ['증명', '추정'],
  ['추정', '간주'],
  ['공유', '합유'],
  ['소멸', '존속'],
  ['즉시', '지체 없이'],
  ['엄격하고', '완화하여'],
  ['원칙적으로', '예외적으로'],
  ['예외적인', '원칙적인'],
  ['반드시', '가급적']
];

/* ── 유형 08 : 및 ↔ 또는 ── */
const CONJUNCTIONS = [
  ['이거나', '이고'],
  ['하거나', '하고'],
  ['되거나', '되고'],
  ['이상이거나', '이상이고'],
  [' 및 ', ' 또는 ']
];

/* ── 유형 13 : 행위 형식 교체 ── */
const ACT_FORMS = ['인가', '승인', '허가', '신고'];

/* ── 유형 14 : 단독 ↔ 공동, 직권 ↔ 신청 ── */
const PROCEDURES = [
  ['단독', '공동'],
  ['직권', '신청'],
  ['촉탁', '신청']
];

/* ── 유형 10 : 방향 반전 ── */
const DIRECTIONS = [
  ['완전비탄력적', '완전탄력적'],
  ['비탄력적', '탄력적'],
  ['상승할수록', '하락할수록'],
  ['길어질수록', '짧아질수록'],
  ['높아진다', '낮아진다'],
  ['커진다', '작아진다'],
  ['많아지는', '적어지는'],
  ['높이는', '낮추는'],
  ['낮추는', '높이는'],
  ['상승', '하락'],
  ['증가', '감소'],
  ['체감', '체증'],
  ['크게', '작게'],
  ['크다', '작다']
];

/* ── 유형 07 : 기산점 이동 ── */
const ANCHORS = [
  ['이 속하는 달의 말일부터', '부터'],
  ['이 속한 달의 말일부터', '부터'],
  ['속하는 달의 말일로부터', '로부터'],
  ['도달한 때', '통지한 때'],
  ['다음 날', '끝나는 때'],
  ['끝나는 때', '다음 날'],
  ['공고일', '고시일'],
  ['등기일', '계약일']
];

/* ── 유형 01·02 : 숫자 교체 (단위별 사다리) ── */
const NUMBER_LADDERS = {
  '일': [3, 4, 5, 7, 10, 14, 15, 20, 30, 60, 90],
  '년': [1, 2, 3, 4, 5, 8, 10, 20],
  '개월': [1, 2, 3, 6, 12],
  '월': [1, 2, 3, 6, 12],
  '%': [1, 2, 3, 5, 8, 10, 12, 15, 25, 30, 43, 50, 60, 70, 80, 100],
  '억원': [1, 3, 6, 9, 12],
  '만원': [20, 45, 150, 250, 300, 500, 1000],
  '층': [3, 5, 10, 16, 21, 30, 50],
  '명': [5, 7, 11, 20, 30, 50, 100, 500],
  '호': [10, 20, 30],
  '세대': [20, 30, 50],
  '시간': [3, 4, 12, 16, 45],
  '점': [4, 15],
  '배': [2, 3, 4]
};
const NUMBER_UNIT_RE = /(\d[\d,]*)\s*(개월|억원|천만원|만원|시간|세대|일|년|월|층|명|호|점|배|%)/g;
const FRACTION_RE = /(\d+)분의\s*(\d+)/g;

/* ── 유형 03 : 경계 조사 (이상 ↔ 초과 만) ── */
const BOUNDARIES = [['이상', '초과'], ['초과', '이상']];

// ───────────────────────────── 유틸 ─────────────────────────────

/* 바꿔 넣은 낱말의 받침에 맞춰 뒤따르는 조사를 고친다.
   인가를 → 승인를 (X) → 승인을 (O) */
const PARTICLE_FIXES = [
  ['을', '를'], ['은', '는'], ['이', '가'], ['과', '와'], ['으로', '로'], ['이나', '나']
];

function hasFinalConsonant(word) {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return false; // 한글 음절이 아니면 판단하지 않는다
  return (last - 0xac00) % 28 !== 0;
}

function fixParticle(text, index, word) {
  const rest = text.slice(index + word.length);
  if (!/[가-힣]$/.test(word)) return text;

  const batchim = hasFinalConsonant(word);
  // '로 / 으로'는 ㄹ 받침 뒤에서 '로'를 쓴다
  const rieul = batchim && (text.charCodeAt(index + word.length - 1) - 0xac00) % 28 === 8;

  for (const [withBatchim, withoutBatchim] of PARTICLE_FIXES) {
    const isRoPair = withBatchim === '으로';
    const wanted = isRoPair
      ? (batchim && !rieul ? withBatchim : withoutBatchim)
      : (batchim ? withBatchim : withoutBatchim);
    const wrong = wanted === withBatchim ? withoutBatchim : withBatchim;

    // 조사 자리인지 확인: 조사 뒤가 어미·공백·문장부호여야 한다
    if (!rest.startsWith(wrong)) continue;
    const after = rest.slice(wrong.length);
    if (after && /^[가-힣]/.test(after) && !/^(\s|$)/.test(after)) {
      if (!/^(는|은|도|만|써|서|부터|까지)/.test(after)) continue;
    }
    return text.slice(0, index) + word + wanted + after;
  }
  return text;
}

function replaceAt(text, index, length, replacement) {
  const merged = text.slice(0, index) + replacement + text.slice(index + length);
  return fixParticle(merged, index, replacement);
}

function allIndexesOf(text, token) {
  const result = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(token, from);
    if (i < 0) break;
    result.push(i);
    from = i + token.length;
  }
  return result;
}

function pickNeighbour(value, ladder, rng) {
  const i = ladder.indexOf(value);
  if (i < 0) {
    const others = ladder.filter(v => v !== value);
    return others.length ? others[Math.floor(rng() * others.length)] : null;
  }
  const candidates = [];
  if (i > 0) candidates.push(ladder[i - 1]);
  if (i < ladder.length - 1) candidates.push(ladder[i + 1]);
  if (!candidates.length) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

function formatNumber(value) {
  return value >= 1000 ? value.toLocaleString('en-US') : String(value);
}

/* 짧고 흔한 낱말은 다른 낱말의 일부일 때 바꾸면 없는 용어가 만들어진다
   (신청정보 → 직권정보, 공동구 → 단독구). 그래서 낱말로 홀로 설 때만 바꾼다. */
const STRICT_STANDALONE = new Set(['단독', '공동', '직권', '신청', '촉탁']);
const SOFT_STANDALONE = new Set([
  '소멸', '존속', '증명', '추정', '간주', '전부', '일부', '포함', '제외',
  '직접', '간접', '현재', '장래', '유효', '무효', '취소', '적법', '위법',
  '선의', '악의', '고의', '과실', '해지', '해제', '갱신', '종료', '공유', '합유'
]);

/* 붙여 써도 바꾼 결과가 실제로 쓰이는 용어가 되는 예외 */
const COMPOUND_ALLOW = [
  '단독주택', '공동주택', '단독신청', '공동신청', '직권말소', '신청말소',
  '해제조건', '해지조건', '공유물', '합유물', '무효행위', '취소행위'
];

const PARTICLE_RE = /^(으로|로|은|는|이|가|을|를|에|의|와|과|도|만|까지|부터|이나|이며|이고|이라|일)/;
const VERB_TAIL_RE = /^(하|한|할|함|해|된|될|되|시)/;

// token 이 text[index] 위치에서 "낱말로 홀로 서 있는지" 판단한다.
function isStandaloneAt(text, index, token) {
  const strict = STRICT_STANDALONE.has(token);
  if (!strict && !SOFT_STANDALONE.has(token)) return true;

  const isHangul = ch => Boolean(ch) && /[가-힣]/.test(ch);
  if (isHangul(text[index - 1])) return false; // 앞에 한글이 붙으면 합성어

  const rest = text.slice(index + token.length);
  if (COMPOUND_ALLOW.some(word => text.startsWith(word, index))) return true;

  // 단독·직권 계열은 "단독으로 / 직권에 따라" 같은 부사어 자리에서만 바꾼다.
  // "일괄하여 신청"의 신청처럼 서술어 자리에 있으면 바꿀 수 없다.
  if (strict) return /^(으로|로|에|의)/.test(rest);

  if (!isHangul(rest[0])) return true;         // 뒤가 조사·기호·끝이면 안전
  if (PARTICLE_RE.test(rest)) return true;
  // 소멸한다 → 존속한다 처럼 양쪽 다 용언이 되는 낱말만 어미를 허용한다
  return VERB_TAIL_RE.test(rest);
}

// ─────────────────────── 유형별 후보 수집 ───────────────────────

// 두 항목이 모두 있으면 서로 맞바꾸고, 하나만 있으면 반대말로 치환한다.
// 합성어 속에 묻힌 낱말은 건드리지 않는다(isStandaloneAt).
function collectPairOps(text, pairs, type) {
  const ops = [];
  for (const [a, b] of pairs) {
    const spotsA = allIndexesOf(text, a).filter(i => isStandaloneAt(text, i, a));
    const spotsB = allIndexesOf(text, b).filter(i => isStandaloneAt(text, i, b));
    if (!spotsA.length && !spotsB.length) continue;

    if (spotsA.length && spotsB.length) {
      ops.push({
        type,
        apply: () => text.split(a).join('\u0000').split(b).join(a).split('\u0000').join(b)
      });
      continue;
    }

    const from = spotsA.length ? a : b;
    const to = spotsA.length ? b : a;
    for (const idx of (spotsA.length ? spotsA : spotsB)) {
      ops.push({ type, apply: () => replaceAt(text, idx, from.length, to) });
    }
  }
  return ops;
}

// 앞쪽(더 구체적인) 규칙부터 훑어 처음 걸리는 규칙만 쓴다. 양쪽 방향 모두 시도한다.
function collectDirectedOps(text, rules, type, bidirectional = true) {
  for (const [a, b, oneWay] of rules) {
    const ops = [];
    const tries = (bidirectional && !oneWay) ? [[a, b], [b, a]] : [[a, b]];
    for (const [from, to] of tries) {
      for (const idx of allIndexesOf(text, from)) {
        ops.push({ type, apply: () => replaceAt(text, idx, from.length, to) });
      }
    }
    if (ops.length) return ops;
  }
  return [];
}

// 문장 맨 끝 서술어만 뒤집는다 (다른 규칙이 하나도 안 걸렸을 때의 최후 수단).
function collectTailOps(text) {
  for (const [from, to] of TAIL_PREDICATES) {
    if (text.endsWith(from)) {
      return [{ type: '서술어 뒤집기', apply: () => replaceAt(text, text.length - from.length, from.length, to) }];
    }
  }
  return [];
}

// 유형 12 : 열거 가감 — 나열된 항목 중 하나를 빼서 목록을 어긋나게 만든다.
function collectListOps(text) {
  const ops = [];

  // 가운뎃점 나열: 도로·상하수도·구거·공원 …
  for (const m of text.matchAll(/[가-힣A-Za-z0-9()]+(?:·[가-힣A-Za-z0-9()]+){2,}/g)) {
    const items = m[0].split('·');
    const index = m.index;
    const length = m[0].length;
    for (let i = 0; i < items.length; i++) {
      const rest = items.filter((_, j) => j !== i);
      ops.push({ type: '열거 가감', apply: () => replaceAt(text, index, length, rest.join('·')) });
    }
  }

  // 쉼표 나열: 계약갱신요구권, 대항력, 권리금, … (항목 3개 이상일 때만)
  const parts = text.split(', ');
  if (parts.length >= 3 && parts.every(p => p.length <= 40)) {
    for (let i = 0; i < parts.length - 1; i++) {
      const rest = parts.filter((_, j) => j !== i);
      ops.push({ type: '열거 가감', apply: () => rest.join(', ') });
    }
  }

  return ops;
}

// 유형 01 변형 : 조문 번호 교체 (제104조 → 제106조)
function collectArticleOps(text, rng) {
  const ops = [];
  for (const m of text.matchAll(/제(\d+)조/g)) {
    const value = parseInt(m[1], 10);
    const delta = [-2, -1, 1, 2][Math.floor(rng() * 4)];
    const next = value + delta;
    if (next <= 0) continue;
    const index = m.index;
    const length = m[0].length;
    ops.push({ type: '조문 번호 교체', apply: () => replaceAt(text, index, length, `제${next}조`) });
  }
  return ops;
}

function collectCycleOps(text, cycle, type, rng) {
  const ops = [];
  for (const token of cycle) {
    for (const idx of allIndexesOf(text, token)) {
      // 더 긴 표현의 일부이면 건너뛴다 (예: '시장·군수' ⊂ '시장·군수·구청장')
      const longer = cycle.some(other =>
        other !== token && other.includes(token) && text.slice(Math.max(0, idx - other.length), idx + other.length).includes(other)
      );
      if (longer) continue;
      const others = cycle.filter(v => v !== token && !v.includes(token) && !token.includes(v));
      if (!others.length) continue;
      ops.push({
        type,
        apply: () => replaceAt(text, idx, token.length, others[Math.floor(rng() * others.length)])
      });
    }
  }
  return ops;
}

function collectNumberOps(text, rng) {
  const ops = [];

  FRACTION_RE.lastIndex = 0;
  for (const m of text.matchAll(FRACTION_RE)) {
    const denom = parseInt(m[1], 10);
    const numer = parseInt(m[2], 10);
    const index = m.index;
    const length = m[0].length;
    if (denom === 100) {
      const next = pickNeighbour(numer, [3, 5, 10, 20, 25, 30, 50], rng);
      if (next !== null) {
        ops.push({ type: '비율 교체', apply: () => replaceAt(text, index, length, `100분의 ${next}`) });
      }
    } else {
      const variants = [[2, 1], [3, 2], [4, 3], [5, 4], [3, 1]].filter(([d, n]) => !(d === denom && n === numer));
      const pick = variants[Math.floor(rng() * variants.length)];
      ops.push({ type: '비율 교체', apply: () => replaceAt(text, index, length, `${pick[0]}분의 ${pick[1]}`) });
    }
  }

  NUMBER_UNIT_RE.lastIndex = 0;
  for (const m of text.matchAll(NUMBER_UNIT_RE)) {
    const unit = m[2];
    const ladder = NUMBER_LADDERS[unit];
    if (!ladder) continue;
    const value = parseInt(m[1].replace(/,/g, ''), 10);
    const next = pickNeighbour(value, ladder, rng);
    if (next === null) continue;
    const index = m.index;
    const length = m[0].length;
    ops.push({
      type: unit === '%' ? '비율 교체' : '기간·수치 교체',
      apply: () => replaceAt(text, index, length, `${formatNumber(next)}${unit}`)
    });
  }

  // 면적(㎡/m²)은 사다리 대신 인접 값으로 이동
  const areaRe = /(\d[\d,]*)\s*(㎡|m²)/g;
  const areaLadder = [30, 60, 100, 150, 200, 250, 500, 1000, 1500, 2000, 5000];
  for (const m of text.matchAll(areaRe)) {
    const value = parseInt(m[1].replace(/,/g, ''), 10);
    const next = pickNeighbour(value, areaLadder, rng);
    if (next === null) continue;
    const index = m.index;
    const length = m[0].length;
    ops.push({
      type: '면적 교체',
      apply: () => replaceAt(text, index, length, `${formatNumber(next)}${m[2]}`)
    });
  }

  return ops;
}

// 이상 ↔ 초과 만 허용. 이하·미만은 원문 그대로 둔다.
function collectBoundaryOps(text) {
  const ops = [];
  for (const [from, to] of BOUNDARIES) {
    for (const idx of allIndexesOf(text, from)) {
      ops.push({ type: '경계 조사', apply: () => replaceAt(text, idx, from.length, to) });
    }
  }
  return ops;
}

// ───────────────────────────── 진입점 ─────────────────────────────

/**
 * 초록색 구간 원문을 받아 "그럴듯한 오답" 한 개를 만들어 돌려준다.
 * 만들 수 없으면 null.
 */
export function mutate(original, rng = Math.random) {
  const text = original;
  let ops = [
    ...collectPairOps(text, SWAP_PAIRS, '당사자·개념 교환'),
    ...collectCycleOps(text, AGENCIES, '행정기관 교환', rng),
    ...collectDirectedOps(text, PREDICATES, '서술어 뒤집기'),
    ...collectDirectedOps(text, ANCHORS, '기산점 이동', false),
    ...collectNumberOps(text, rng),
    ...collectArticleOps(text, rng),
    ...collectListOps(text),
    ...collectBoundaryOps(text),
    ...collectPairOps(text, DIRECTIONS, '방향 반전'),
    ...collectPairOps(text, CONCEPTS, '닮은 개념 교환'),
    ...collectCycleOps(text, ACT_FORMS, '행위 형식 교체', rng),
    ...collectPairOps(text, PROCEDURES, '단독·직권 교체'),
    ...collectPairOps(text, CONJUNCTIONS, '및 ↔ 또는')
  ];

  if (!ops.length) ops = collectTailOps(text);

  const shuffled = ops.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (const op of shuffled) {
    let result;
    try {
      result = op.apply();
    } catch (e) {
      continue;
    }
    if (result && result !== text) {
      return { text: result, type: op.type };
    }
  }
  return null;
}
