# -*- coding: utf-8 -*-
"""
SecureMeet AI (시큐어미트 AI) - 사내 기밀 유출 없는 오프라인 음성 회의록 실시간 전사,
목소리(성문) 자동 화자 분리(Speaker Diarization) 및 평생 성문 기억 & 액션 아이템 자동 추출 서버
"""
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import json
import re
import random
from pathlib import Path
from typing import Optional, List, Dict, Any

app = FastAPI(title="SecureMeet AI - 오프라인 기밀 회의록 & 성문 화자분리/액션 추출기", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).resolve().parent / "data.db"

VOICE_SIGNATURE_SPECS = {
    "VOICE_A": "112Hz 중저음 · 성문패턴 #VP-112A",
    "VOICE_B": "146Hz 중음 · 성문패턴 #VP-146B",
    "VOICE_C": "214Hz 밝은 중고음 · 성문패턴 #VP-214C",
    "VOICE_D": "164Hz 차분한 바리톤 · 성문패턴 #VP-164D",
    "VOICE_E": "192Hz 선명한 하이톤 · 성문패턴 #VP-192E",
}

PRESET_SCENARIO_POOL = [
    {
        "title": "자율주행 라이다(LiDAR) 센서 핵심 알고리즘 특허 방어 회의",
        "meeting_type": "🔬 R&D 연구개발/특허 보안 회의",
        "icon": "🚗",
        "utterances": [
            {"voice_id": "VOICE_A", "text": "라이다 악천후 노이즈 제거 알고리즘 소스코드는 1급 영업비밀이므로 외부망 반출을 엄격히 차단합니다."},
            {"voice_id": "VOICE_B", "text": "11월 15일(토)까지 야간 폭우 환경 인식률 99.2% 벤치마크 검증 보고서를 작성하여 제출하겠습니다."},
            {"voice_id": "VOICE_B", "text": "추가로 악천후 센서 퓨전 데이터셋 암호화 백업도 오늘 오후까지 함께 완료하겠습니다."},
            {"voice_id": "VOICE_C", "text": "11월 18일(화)까지 미국·유럽 PCT 국제특허 선출원 명세서 8건 작성 완료하겠습니다."},
            {"voice_id": "VOICE_D", "text": "내일 오전까지 연구소 폐쇄망 Git 저장소 접근 권한 2차 생체인증 패치 적용하겠습니다."}
        ]
    },
    {
        "title": "사내 개인정보·기밀 유출 원천 차단 제로트러스트 보안 긴급 대책 회의",
        "meeting_type": "🛡️ 사내 기밀 보안 대책 회의",
        "icon": "🛡️",
        "utterances": [
            {"voice_id": "VOICE_A", "text": "최근 외부 생성형 AI 웹서비스를 통한 사내 코드 유출 시도가 급증하여 전사 DLP 차단 정책을 강화합니다."},
            {"voice_id": "VOICE_B", "text": "오늘 18시까지 사내망에서 미인가 외부 클라우드 AI 사이트 접속 차단 방화벽 정책을 즉시 배포하겠습니다."},
            {"voice_id": "VOICE_C", "text": "11월 14일(금)까지 전 임직원 노트북 USB 매체 제어 및 로컬 암호화 에이전트 업데이트 완료하겠습니다."},
            {"voice_id": "VOICE_C", "text": "미설치 단말기에 대한 네트워크 격리 테스트도 금주 금요일까지 함께 보고하겠습니다."},
            {"voice_id": "VOICE_D", "text": "금주 목요일까지 폐쇄망 오프라인 음성 회의록 시스템 전 부서 배포 가이드 공유하겠습니다."}
        ]
    },
    {
        "title": "차세대 방산 암호화 드론 통신 모듈 국책과제 최종 점검 회의",
        "meeting_type": "🚀 프로젝트 스프린트/일정 점검",
        "icon": "🚁",
        "utterances": [
            {"voice_id": "VOICE_A", "text": "국방 과학기술 과제의 모든 음성 회의록은 망분리 오프라인 STT 장비에서만 기록 및 보관되어야 합니다."},
            {"voice_id": "VOICE_B", "text": "11월 13일(목)까지 양자내성암호(PQC) 기반 드론 제어 채널 주파수 도약 테스트 결과를 보고하겠습니다."},
            {"voice_id": "VOICE_C", "text": "금주 금요일까지 영하 30도 극한환경 온디바이스 AI 칩셋 발열 및 전력 소모 최적화 패치 완료하겠습니다."},
            {"voice_id": "VOICE_D", "text": "11월 17일(월)까지 방위사업청 보안 적합성 검증 심사 서류 일체 준비 완료하겠습니다."}
        ]
    }
]


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1. 회의 참석자 및 평생 성문(Voiceprint) 영구 기억 테이블
    cur.execute('''
        CREATE TABLE IF NOT EXISTS attendees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            department TEXT DEFAULT '사내 참석자',
            is_attending INTEGER DEFAULT 1,
            voice_id TEXT DEFAULT NULL,
            voice_spec TEXT DEFAULT NULL,
            voice_registered INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 2. 액션 아이템 테이블
    cur.execute('''
        CREATE TABLE IF NOT EXISTS action_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_title TEXT DEFAULT '임원 기술전략 회의',
            assignee TEXT DEFAULT '담당자 미정',
            priority TEXT DEFAULT '높음',
            task TEXT,
            due_date TEXT DEFAULT '금주 내',
            done INTEGER DEFAULT 0,
            is_new INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 3. 시뮬레이션 테이블 (목소리 ID 기반 다화자 발언 포함)
    cur.execute('''
        CREATE TABLE IF NOT EXISTS simulations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sim_number INTEGER,
            icon TEXT DEFAULT '🎬',
            meeting_type TEXT DEFAULT '🛡️ 사내 기밀 보안 대책 회의',
            title TEXT,
            utterances_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 4. 회의 이력 테이블
    cur.execute('''
        CREATE TABLE IF NOT EXISTS meetings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_datetime TEXT,
            meeting_type TEXT,
            meeting_title TEXT,
            attendees_json TEXT,
            transcript TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 기본 참석자 시드 데이터 (최상무 1명은 성문 기등록 상태로 자동 인식 시연, 나머지 3명은 미등록 상태로 일괄 매핑 & 평생 기억 시연)
    cur.execute("SELECT count(*) FROM attendees")
    if cur.fetchone()[0] == 0:
        seed_attendees = [
            ("최상무", "반도체연구소장", 1, "VOICE_A", VOICE_SIGNATURE_SPECS["VOICE_A"], 1),
            ("김수석", "공정기술팀", 1, None, None, 0),
            ("박변리사", "법무특허팀", 1, None, None, 0),
            ("이팀장", "정보보안팀", 1, None, None, 0),
        ]
        cur.executemany(
            "INSERT INTO attendees (name, department, is_attending, voice_id, voice_spec, voice_registered) VALUES (?, ?, ?, ?, ?, ?)",
            seed_attendees
        )

    cur.execute("SELECT count(*) FROM action_items")
    if cur.fetchone()[0] == 0:
        seed_rows = [
            ("차세대 온디바이스 AI 보안 아키텍처 회의", "김수석 (공정기술팀)", "긴급", "사내 폐쇄망 LLM 추론 서버 방화벽 정책 및 망분리 보안성 검토서 제출", "11월 10일(월)", 0, 0),
            ("차세대 온디바이스 AI 보안 아키텍처 회의", "이팀장 (정보보안팀)", "높음", "Whisper.cpp 기반 오프라인 실시간 한국어 음성 전사 지연시간 0.4초 이하 최적화", "11월 12일(수)", 0, 0),
            ("2026 Q4 엔터프라이즈 B2B 영업 전략 회의", "최상무 (반도체연구소장)", "보통", "금융권·방산 고객사용 온프레미스 구축 견적서 및 SLA 계약서 초안 배포", "완료됨", 1, 0),
        ]
        cur.executemany(
            "INSERT INTO action_items (meeting_title, assignee, priority, task, due_date, done, is_new) VALUES (?, ?, ?, ?, ?, ?, ?)",
            seed_rows
        )

    # 시뮬레이션 기본 데이터 (각 목소리 VOICE_B, VOICE_C가 여러 문장을 말하도록 구성하여 '한 번 선택 시 동일 목소리 문장 일괄 기록'을 즉시 확인 가능!)
    cur.execute("SELECT count(*) FROM simulations")
    if cur.fetchone()[0] == 0:
        default_sims = [
            (
                1,
                "🎬",
                "🛡️ 사내 기밀 보안 대책 회의",
                "차세대 2나노 AI 반도체 수율 & 특허 기밀 보안 대책 회의",
                json.dumps([
                    {"voice_id": "VOICE_A", "text": "이번 2나노 NPU 패키징 공정 수율 데이터는 1급 사내 기밀이므로 외부 클라우드 회의록 툴 사용을 전면 금지합니다."},
                    {"voice_id": "VOICE_B", "text": "11월 12일(수)까지 웨이퍼 결함 밀도 분석 리포트 및 수율 88% 달성 개선안을 작성하여 보고하겠습니다."},
                    {"voice_id": "VOICE_B", "text": "아울러 클린룸 3라인 식각 공정 온도 편차 데이터 검증도 내일 오후까지 함께 완료하겠습니다."},
                    {"voice_id": "VOICE_C", "text": "11월 14일(금)까지 경쟁사 특허 침해 원천 차단용 핵심 청구항 12건 명세서 제출 완료하겠습니다."},
                    {"voice_id": "VOICE_C", "text": "해외 법무법인 비밀유지계약(NDA) 갱신 검토서도 금주 목요일까지 공유하겠습니다."},
                    {"voice_id": "VOICE_D", "text": "내일 오후까지 연구소 폐쇄망 서버 내 로컬 Whisper 음성 전사 엔진 보안 패치 배포 진행하겠습니다."}
                ], ensure_ascii=False)
            ),
            (
                2,
                "🏦",
                "🏦 금융/인프라 컴플라이언스 회의",
                "금융권 망분리 온프레미스 LLM 구축 & 보안 감사 임원 회의",
                json.dumps([
                    {"voice_id": "VOICE_A", "text": "금융감독원 망분리 가이드라인에 맞춰 사내 회의 음성은 100% 로컬 장비에서만 전사되어야 합니다."},
                    {"voice_id": "VOICE_B", "text": "11월 13일(목)까지 사내 폐쇄망 GPU 노드 4대에 로컬 요약 모델 구축 완료하겠습니다."},
                    {"voice_id": "VOICE_B", "text": "동시에 사내 음성 성문(Voiceprint) DB 암호화 스토리지 이중화 작업도 금주 내로 마무리하겠습니다."},
                    {"voice_id": "VOICE_C", "text": "금주 금요일까지 개인정보 및 계좌번호 실시간 비식별화 마스킹 필터 검증 보고서 제출하겠습니다."},
                    {"voice_id": "VOICE_D", "text": "내일 오전까지 망분리 환경 침투 테스트 및 보안 감사 체크리스트 점검 결과를 보고하겠습니다."}
                ], ensure_ascii=False)
            )
        ]
        cur.executemany(
            "INSERT INTO simulations (sim_number, icon, meeting_type, title, utterances_json) VALUES (?, ?, ?, ?, ?)",
            default_sims
        )

    conn.commit()
    conn.close()


init_db()


class AttendeeCreateRequest(BaseModel):
    name: str
    department: Optional[str] = "사내 참석자"


class VoiceBindRequest(BaseModel):
    attendee_id: int
    voice_id: str
    voice_spec: Optional[str] = None


class BulkVoiceSaveRequest(BaseModel):
    mappings: List[VoiceBindRequest]


class ActionItemCreate(BaseModel):
    meeting_title: Optional[str] = "수동 등록 액션"
    assignee: Optional[str] = "전체"
    priority: Optional[str] = "높음"
    task: str
    due_date: Optional[str] = "이번 주"


class UtteranceItem(BaseModel):
    voice_id: str
    speaker_name: Optional[str] = None
    text: str


class MeetingTranscriptRequest(BaseModel):
    meeting_datetime: Optional[str] = ""
    meeting_type: Optional[str] = "🛡️ 사내 기밀 보안 대책 회의"
    meeting_title: str = "사내 기밀 프로젝트 회의"
    transcript: str
    mappings: Optional[List[VoiceBindRequest]] = None


class SimulationCreateRequest(BaseModel):
    topic: Optional[str] = ""
    meeting_type: Optional[str] = "🛡️ 사내 기밀 보안 대책 회의"


@app.get("/api/health")
def health():
    return {
        "status": "online",
        "app": "SecureMeet AI — 오프라인 성문(Voiceprint) 평생기억 화자분리 & 액션 추출기",
        "security_mode": "100% Air-Gapped On-Premise",
        "version": "3.0.0"
    }


# =========================================================================
# 회의 참석자 & 평생 목소리(성문) 기억 관리 API
# =========================================================================
@app.get("/api/attendees")
def get_attendees():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        SELECT id, name, department, is_attending, voice_id, voice_spec, voice_registered, updated_at
        FROM attendees
        ORDER BY id ASC
    """)
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": r[0],
            "name": r[1],
            "department": r[2],
            "display_label": f"{r[1]} ({r[2]})" if r[2] else r[1],
            "is_attending": bool(r[3]),
            "voice_id": r[4],
            "voice_spec": r[5] or (VOICE_SIGNATURE_SPECS.get(r[4]) if r[4] else None),
            "voice_registered": bool(r[6]),
            "updated_at": r[7]
        }
        for r in rows
    ]


@app.post("/api/attendees")
def add_attendee(req: AttendeeCreateRequest):
    name = req.name.strip()
    dept = (req.department or "사내 참석자").strip()
    if not name:
        raise HTTPException(status_code=400, detail="참석자 이름을 입력해 주세요.")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO attendees (name, department, is_attending, voice_id, voice_spec, voice_registered) VALUES (?, ?, 1, NULL, NULL, 0)",
        (name, dept)
    )
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {
        "success": True,
        "attendee": {
            "id": new_id,
            "name": name,
            "department": dept,
            "display_label": f"{name} ({dept})",
            "is_attending": True,
            "voice_id": None,
            "voice_spec": None,
            "voice_registered": False
        }
    }


@app.post("/api/attendees/{attendee_id}/toggle-attending")
def toggle_attendee_attending(attendee_id: int):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("UPDATE attendees SET is_attending = CASE WHEN is_attending = 1 THEN 0 ELSE 1 END WHERE id = ?", (attendee_id,))
    conn.commit()
    conn.close()
    return {"success": True, "id": attendee_id}


@app.delete("/api/attendees/{attendee_id}")
def delete_attendee(attendee_id: int):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM attendees WHERE id = ?", (attendee_id,))
    conn.commit()
    conn.close()
    return {"success": True, "id": attendee_id}


@app.post("/api/attendees/bind-voice")
def bind_voice_to_attendee(req: VoiceBindRequest):
    """
    특정 목소리 클러스터(voice_id)를 선택한 참석자(attendee_id)에게 매핑하고
    로컬 성문 DB에 평생 기억(영구 저장)합니다.
    """
    spec = req.voice_spec or VOICE_SIGNATURE_SPECS.get(req.voice_id, f"성문패턴 #{req.voice_id}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    # 만약 다른 참석자에게 같은 voice_id가 할당되어 있었다면 해제
    cur.execute("UPDATE attendees SET voice_id = NULL, voice_spec = NULL, voice_registered = 0 WHERE voice_id = ? AND id != ?", (req.voice_id, req.attendee_id))
    cur.execute(
        "UPDATE attendees SET voice_id = ?, voice_spec = ?, voice_registered = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (req.voice_id, spec, req.attendee_id)
    )
    conn.commit()
    conn.close()
    return {"success": True, "attendee_id": req.attendee_id, "voice_id": req.voice_id, "voice_spec": spec}


@app.post("/api/attendees/reset-all-voices")
def reset_all_voices():
    """
    성문 기억 초기화 (최상무 VOICE_A만 남기거나 전체 초기화하여 미등록 목소리 분류 테스트 가능)
    """
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("UPDATE attendees SET voice_id = NULL, voice_spec = NULL, voice_registered = 0")
    conn.commit()
    conn.close()
    return {"success": True}


# =========================================================================
# 시뮬레이션 조회 및 생성 API (목소리 ID 기반 다화자 대화)
# =========================================================================
@app.get("/api/simulations")
def get_simulations():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, sim_number, icon, meeting_type, title, utterances_json FROM simulations ORDER BY sim_number ASC, id ASC")
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": r[0],
            "sim_number": r[1],
            "icon": r[2],
            "meeting_type": r[3] or "🛡️ 사내 기밀 보안 대책 회의",
            "title": r[4],
            "utterances": json.loads(r[5])
        }
        for r in rows
    ]


@app.post("/api/simulations")
def create_simulation(req: SimulationCreateRequest):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT COALESCE(MAX(sim_number), 0) FROM simulations")
    next_num = cur.fetchone()[0] + 1

    topic = (req.topic or "").strip()
    m_type = (req.meeting_type or "🛡️ 사내 기밀 보안 대책 회의").strip()

    if topic:
        icon = "🚀"
        title = f"{topic} — 사내 기밀 보안 및 실행 대책 회의"
        utterances = [
            {"voice_id": "VOICE_A", "text": f"지금부터 '{topic}' 관련 사내 기밀 대책 회의를 시작합니다. 모든 음성은 외부 유출 없이 로컬에서만 전사됩니다."},
            {"voice_id": "VOICE_B", "text": f"11월 13일(목)까지 {topic} 세부 실행 로드맵 및 리스크 분석 보고서를 작성하여 공유하겠습니다."},
            {"voice_id": "VOICE_B", "text": f"관련 부서별 예산 산정 및 인력 배분 계획안도 금주 수요일까지 먼저 제출하겠습니다."},
            {"voice_id": "VOICE_C", "text": f"금주 금요일까지 {topic} 관련 폐쇄망 프로토타입 모듈 검증 및 보안 테스트를 완료하겠습니다."},
            {"voice_id": "VOICE_D", "text": f"내일 오후까지 {topic} 관련 기밀 데이터 접근 권한 통제 및 암호화 패치를 즉시 적용하겠습니다."}
        ]
    else:
        cur.execute("SELECT title FROM simulations")
        existing_titles = {r[0] for r in cur.fetchall()}
        candidates = [p for p in PRESET_SCENARIO_POOL if p["title"] not in existing_titles]
        chosen = candidates[0] if candidates else random.choice(PRESET_SCENARIO_POOL)
        icon = chosen["icon"]
        m_type = chosen["meeting_type"]
        title = chosen["title"] if chosen["title"] not in existing_titles else f"{chosen['title']} ({next_num}차)"
        utterances = chosen["utterances"]

    cur.execute(
        "INSERT INTO simulations (sim_number, icon, meeting_type, title, utterances_json) VALUES (?, ?, ?, ?, ?)",
        (next_num, icon, m_type, title, json.dumps(utterances, ensure_ascii=False))
    )
    sim_id = cur.lastrowid
    conn.commit()
    conn.close()

    return {
        "success": True,
        "simulation": {
            "id": sim_id,
            "sim_number": next_num,
            "icon": icon,
            "meeting_type": m_type,
            "title": title,
            "utterances": utterances
        }
    }


@app.delete("/api/simulations/{sim_id}")
def delete_simulation(sim_id: int):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM simulations WHERE id = ?", (sim_id,))
    conn.commit()
    conn.close()
    return {"success": True, "id": sim_id}


# =========================================================================
# 액션 아이템 및 회의 분석 + 성문 영구 저장 API
# =========================================================================
@app.get("/api/items")
def get_items():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, meeting_title, assignee, priority, task, due_date, done, is_new, created_at FROM action_items ORDER BY done ASC, id DESC")
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": r[0],
            "meeting_title": r[1],
            "assignee": r[2],
            "priority": r[3],
            "task": r[4],
            "due_date": r[5],
            "done": bool(r[6]),
            "is_new": bool(r[7]),
            "created_at": r[8]
        }
        for r in rows
    ]


@app.post("/api/items")
def create_item(req: ActionItemCreate):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("UPDATE action_items SET is_new = 0")
    cur.execute(
        "INSERT INTO action_items (meeting_title, assignee, priority, task, due_date, done, is_new) VALUES (?, ?, ?, ?, ?, 0, 1)",
        (req.meeting_title, req.assignee, req.priority, req.task, req.due_date)
    )
    conn.commit()
    conn.close()
    return {"success": True, "task": req.task}


@app.post("/api/items/{item_id}/toggle")
def toggle_item(item_id: int):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("UPDATE action_items SET done = CASE WHEN done = 1 THEN 0 ELSE 1 END WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return {"success": True, "id": item_id}


@app.delete("/api/items/{item_id}")
def delete_item(item_id: int):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM action_items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()
    return {"success": True, "id": item_id}


@app.post("/api/analyze-meeting")
def analyze_meeting(req: MeetingTranscriptRequest):
    """
    회의 종료 시:
    1) 이번 회의에서 선택/매핑된 참석자들의 목소리(성문)를 영구 저장(평생 기억)
    2) 회의 메타정보(일시, 회의 종류, 제목, 전문) 저장
    3) 로컬 AI 3줄 핵심 요약 및 담당자별 액션 아이템 자동 추출
    """
    text = req.transcript.strip()
    if not text:
        raise HTTPException(status_code=400, detail="회의록 전사 내용을 입력해 주세요.")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1) 회의 중 매핑된 목소리 성문이 있으면 평생 기억 DB에 영구 반영
    saved_voice_count = 0
    if req.mappings:
        for m in req.mappings:
            spec = m.voice_spec or VOICE_SIGNATURE_SPECS.get(m.voice_id, f"성문패턴 #{m.voice_id}")
            cur.execute("UPDATE attendees SET voice_id = NULL, voice_spec = NULL, voice_registered = 0 WHERE voice_id = ? AND id != ?", (m.voice_id, m.attendee_id))
            cur.execute(
                "UPDATE attendees SET voice_id = ?, voice_spec = ?, voice_registered = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (m.voice_id, spec, m.attendee_id)
            )
            saved_voice_count += 1

    # 2) 회의 이력 저장
    cur.execute(
        "INSERT INTO meetings (meeting_datetime, meeting_type, meeting_title, attendees_json, transcript) VALUES (?, ?, ?, ?, ?)",
        (req.meeting_datetime or "", req.meeting_type or "", req.meeting_title, "[]", text)
    )

    lines = [ln.strip() for ln in re.split(r'[\n\r]+', text) if ln.strip()]
    extracted_actions = []
    summary_points = []

    action_keywords = [
        "제출", "작성", "완료", "진행", "검토", "구축", "배포", "보고", "적용",
        "준비", "부탁", "패치", "공유", "점검", "수정", "업데이트", "개발", "테스트",
        "분석", "확인", "발송", "정리", "계획", "실행", "처리", "까지", "하겠습니다", "할게요", "해주세요"
    ]

    for ln in lines:
        speaker_match = re.match(r'^(?:\[([^\]]+)\]|([가-힣A-Za-z0-9_\s\(\)·#\-]+?))\s*[:\-]\s*(.+)$', ln)
        if speaker_match:
            speaker = (speaker_match.group(1) or speaker_match.group(2)).strip()
            utterance = speaker_match.group(3).strip()
        else:
            speaker = "회의 참석자"
            utterance = re.sub(r'^(?:[\-\*\•]\s*|\d+[\.\)]\s*)', '', ln).strip()

        if len(utterance) < 2:
            continue

        summary_points.append(f"[{speaker}] {utterance[:75]}")

        due_match = re.search(
            r'(\d{1,2}월\s*\d{1,2}일(?:\([월화수목금토일]\))?|금주\s*[월화수목금]요일|금주\s*내|내일(?:\s*오전|\s*오후|\s*\d{1,2}시까지)?|오늘(?:\s*\d{1,2}시까지|\s*오후|\s*중으로)?|이번\s*주(?:\s*[월화수목금]요일)?|\d{1,2}시까지)',
            utterance
        )
        due_str = due_match.group(1) if due_match else "이번 주 내"

        if any(k in utterance for k in ["긴급", "즉시", "보안", "유출", "차단", "오늘", "반드시", "1급", "비상"]):
            prio = "긴급"
        elif any(k in utterance for k in ["제출", "배포", "완료", "마감", "검토", "작성", "구축", "최적화", "진행", "패치", "보고"]):
            prio = "높음"
        else:
            prio = "보통"

        if any(k in utterance for k in action_keywords):
            extracted_actions.append((req.meeting_title, speaker, prio, utterance, due_str))

    if not extracted_actions and lines:
        first_ln = lines[-1]
        extracted_actions.append((req.meeting_title, "회의 참석자", "높음", first_ln[:95], "이번 주 내"))

    cur.execute("UPDATE action_items SET is_new = 0")

    newly_inserted = []
    for (m_title, assignee, prio, task_text, due_str) in extracted_actions:
        cur.execute("SELECT id FROM action_items WHERE task = ?", (task_text,))
        existing = cur.fetchone()
        if existing:
            cur.execute("UPDATE action_items SET assignee = ?, priority = ?, due_date = ?, is_new = 1 WHERE id = ?", (assignee, prio, due_str, existing[0]))
        else:
            cur.execute(
                "INSERT INTO action_items (meeting_title, assignee, priority, task, due_date, done, is_new) VALUES (?, ?, ?, ?, ?, 0, 1)",
                (m_title, assignee, prio, task_text, due_str)
            )
        newly_inserted.append({"meeting_title": m_title, "assignee": assignee, "priority": prio, "task": task_text, "due_date": due_str})

    conn.commit()
    conn.close()

    return {
        "success": True,
        "meeting_title": req.meeting_title,
        "summary": summary_points[:4],
        "extracted_count": len(newly_inserted),
        "saved_voice_count": saved_voice_count,
        "actions": newly_inserted
    }


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9050)
