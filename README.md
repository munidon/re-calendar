# 공인중개사 수강 캘린더

공인중개사 시험 대비 수강 진도 관리 및 기출문제 풀이 웹 앱입니다.

## 주요 기능

- **캘린더**: 2026년 2월~9월 학습 일정 관리, D-Day 표시
- **수강 진행 현황**: 6개 과목 × 6개 커리큘럼(기본이론 · 핵심요약 · 기출문제 · 예상문제 · 동형모의 · 적중100선) 진도 체크
- **기출문제 풀이**: 연도별 기출문제(1차/2차) 풀이 및 채점
- **기출문제 풀이 조회**: 지난 풀이 기록 확인
- **세부계획서**: PDF 계획서를 앱 안에서 바로 열람
- **기기 코드 동기화**: 기기 코드로 여러 기기에서 진도 데이터 공유

## 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| 프론트엔드 | HTML, CSS, Vanilla JavaScript (ES Modules) |
| 데이터베이스 | Firebase Firestore (v10.8.0, CDN) |
| 호스팅/배포 | Firebase |
| PDF 렌더링 | PDF.js 3.11.174 (CDN) |
| 에셋 빌드 | Python 3 (Pillow, NumPy, poppler-utils) |

빌드 도구나 번들러 없이 정적 파일만으로 동작합니다.

## 프로젝트 구조

```
index.html          # 앱 화면 마크업
app.js              # 캘린더 · 진도 · 기출문제 로직
config.js           # Firebase 설정
style.css           # 스타일
firebase.json       # Firebase 설정
firestore.rules     # Firestore 보안 규칙
plan.pdf            # 세부계획서
assets/exams/       # 연도별 기출문제 이미지 및 JSON
scripts/            # 기출문제 에셋 생성 스크립트 (Python)
```

## 실행 방법

ES Modules를 사용하므로 정적 서버로 실행해야 합니다.

```bash
python3 -m http.server 8000
# http://localhost:8000 접속
```
