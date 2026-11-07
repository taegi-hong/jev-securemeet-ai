# -*- coding: utf-8 -*-
"""
JEV AI Prototype - FastAPI Local Backend Server
"""
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
from pathlib import Path

app = FastAPI(title="JEV AI Prototype API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).resolve().parent / "data.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cur.execute("SELECT count(*) FROM records")
    if cur.fetchone()[0] == 0:
        cur.execute("INSERT INTO records (title, status) VALUES ('시스템 초기화 완료', 'active')")
        cur.execute("INSERT INTO records (title, status) VALUES ('로컬 AI 엔진 대기 중', 'ready')")
    conn.commit()
    conn.close()

init_db()

class ItemRequest(BaseModel):
    title: str

@app.get("/api/health")
def health():
    return {"status": "online", "app": "JEV AI Prototype", "version": "1.0.0"}

@app.get("/api/items")
def get_items():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, title, status, created_at FROM records ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "title": r[1], "status": r[2], "created_at": r[3]} for r in rows]

@app.post("/api/items")
def create_item(req: ItemRequest):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("INSERT INTO records (title, status) VALUES (?, 'active')", (req.title,))
    conn.commit()
    conn.close()
    return {"success": True, "title": req.title}

# 프론트엔드 정적 파일 서빙
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9050)
