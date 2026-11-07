# JEV AI Prototype - Product Requirement Document (PRD)

> **One-liner**:   
> **Core UVP**: 

## 1. 개요 및 목적
본 프로토타입은 클라우드 구독료 부담과 데이터 유출 우려를 원천 차단하는 로컬 우선(Local-First) 고성능 애플리케이션입니다.

## 2. 주요 기능 명세
1. **대시보드 메인 뷰**: 핵심 KPI 카드 및 상태 모니터링
2. **로컬 데이터 처리 엔진**: 개인정보를 외부로 전송하지 않는 로컬 온프레미스 파이프라인
3. **인터랙티브 워크스페이스**: 사용자 요청 처리 및 실시간 결과 시각화
4. **설정 및 데이터 관리**: 로컬 SQLite 데이터베이스 연동

## 3. 기술 스택
- **Backend**: Python FastAPI, SQLite, Pydantic
- **Frontend**: Vanilla HTML5, Modern CSS (Glassmorphism), JavaScript (ES6)
- **AI Engine**: Local LLM (Ollama/LM Studio) & Google Gemini Hybrid
- **Visual Assets**: ComfyUI (Port 8188)
