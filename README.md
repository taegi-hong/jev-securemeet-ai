# 🎙️ SecureMeet AI v3.0 — 사내 기밀 유출 없는 오프라인 성문(Voiceprint) 화자분리 & 액션 아이템 추출기

> **One-liner**: 외부 클라우드 전송 0% · 폐쇄망 로컬 STT 실시간 전사, 목소리(성문) 평생 기억 기반 자동 화자 분리 및 담당자별 Action Item 자동 생성기

## 1. 주요 기능 명세 (v3.0 업데이트)
1. **📅 회의 일시 · 회의 종류 선택 및 👥 회의 참석자 관리**
   - 회의 일시(`datetime-local`), 회의 종류(기밀 보안 대책, R&D/특허, 임원 전략, 스프린트 점검, 금융 컴플라이언스), 회의 제목 설정
   - 회의 참석자 실시간 추가(`＋ 회의 참석자 추가`), 참석 여부 체크박스 및 참석자별 성문(Voiceprint) 등록 상태 표시
2. **🎤 회의 시작 ~ 종료 연속 음성인식 & 🎵 목소리 변화 감지 자동 분류**
   - 회의 시작부터 종료까지 음성을 연속 인식하며, 목소리 주파수/음색(`VOICE_A` ~ `VOICE_E`)이 달라질 때마다 대화 문장을 자동으로 분리 기록
3. **⚡ 참석자 1회 선택 시 동일 목소리 문장 '일괄 기록' (Batch Speaker Assignment)**
   - 미분류 목소리 문장에서 회의 참석자를 1번만 선택하면, 회의 전체에서 같은 목소리가 말한 모든 문장이 해당 참석자로 즉시 일괄 변경·기록됨
4. **🧠 목소리(성문) 평생 기억 & 후속 회의 100% 자동 분류 (Permanent Voiceprint DB)**
   - 한 번 매핑된 참석자의 목소리(성문)는 로컬 SQLite DB(`attendees` 테이블)에 영구 저장되어, 이후 새로운 회의가 추가될 때마다 선택 없이 자동으로 화자가 분류됨
5. **📋 로컬 AI 3줄 핵심 요약 & 화자별 액션 아이템 자동 추출**
   - 회의 종료 시 발언자(담당자), 마감 기한, 우선순위(`긴급`/`높음`/`보통`)를 자동 판별하여 액션 아이템 보드에 등록

## 2. 실행 방법
```bash
python3 backend/main.py
# 브라우저에서 http://127.0.0.1:9050 접속
```

## 3. 기술 스택
- **Backend**: Python FastAPI, SQLite (`attendees`, `simulations`, `meetings`, `action_items`), Pydantic
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (Web Speech API + Web Audio API FFT 성문 주파수 분석)
