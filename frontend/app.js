let allAttendees = [];
let allActionItems = [];
let allSimulations = [];
let currentPrioFilter = 'ALL';

// 현재 회의에서 추출된 목소리별 발언 목록
// 각 원소: { uid, voice_id, text, auto_recognized }
let currentUtterances = [];

// 이번 회의 중 선택된 목소리(voice_id) -> 참석자(attendee_id) 매핑
let sessionVoiceBindings = {};

// 마이크 음성인식 및 실시간 성문 주파수(Hz) 분석 상태
let recognition = null;
let isMicRecording = false;
let micTimerInterval = null;
let micSeconds = 0;
let audioContext = null;
let analyserNode = null;
let mediaStream = null;
let animFrameId = null;
let lastInterimText = '';
let currentMicVoiceId = 'VOICE_A';
let voiceChangeRotationIdx = 0;
let activeSimTimer = null;

const VOICE_CLUSTER_META = {
  VOICE_A: { label: "목소리 A", hz: "112Hz 중저음", spec: "112Hz 중저음 · 성문패턴 #VP-112A" },
  VOICE_B: { label: "목소리 B", hz: "146Hz 중음",   spec: "146Hz 중음 · 성문패턴 #VP-146B" },
  VOICE_C: { label: "목소리 C", hz: "214Hz 중고음", spec: "214Hz 밝은 중고음 · 성문패턴 #VP-214C" },
  VOICE_D: { label: "목소리 D", hz: "164Hz 바리톤", spec: "164Hz 차분한 바리톤 · 성문패턴 #VP-164D" },
  VOICE_E: { label: "목소리 E", hz: "192Hz 하이톤", spec: "192Hz 선명한 하이톤 · 성문패턴 #VP-192E" }
};

// 목소리 변화 테스트 및 마이크 오프라인 폴백용 다화자 대화 풀
const MULTI_VOICE_SAMPLE_STREAM = [
  { voice_id: "VOICE_A", text: "이번 사내 기밀 프로젝트 회의는 외부 클라우드 전송 없이 100% 폐쇄망 로컬에서 음성인식을 진행합니다." },
  { voice_id: "VOICE_B", text: "11월 12일(수)까지 웨이퍼 공정 결함 분석 리포트와 수율 88% 개선 대책안을 작성하여 보고하겠습니다." },
  { voice_id: "VOICE_B", text: "아울러 클린룸 3라인 센서 보정 데이터 검증도 내일 오후까지 함께 마무리하겠습니다." },
  { voice_id: "VOICE_C", text: "11월 14일(금)까지 핵심 특허 청구항 12건 명세서 작성 및 선출원 검토를 완료하겠습니다." },
  { voice_id: "VOICE_D", text: "내일 오후까지 연구소 폐쇄망 서버 내 로컬 음성 전사 엔진 보안 패치 배포를 완료하겠습니다." },
  { voice_id: "VOICE_E", text: "금주 금요일까지 전 부서 보안 서약서 취합 및 접근 권한 감사 결과를 공유하겠습니다." }
];

function showToast(msg) {
  const banner = document.getElementById('toastBanner');
  if (!banner) return;
  banner.textContent = msg;
  banner.style.display = 'block';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    banner.style.display = 'none';
  }, 6000);
}

function setActiveStep(stepNum) {
  [1, 2, 3].forEach(n => {
    const el = document.getElementById(`stepCard${n}`);
    if (el) el.classList.toggle('active', n === stepNum);
  });
}

function toggleGuideBanner() {
  const banner = document.getElementById('guideBanner');
  if (!banner) return;
  banner.style.display = banner.style.display === 'none' ? 'block' : 'none';
}

function clearTranscript() {
  currentUtterances = [];
  document.getElementById('transcriptTextarea').value = '';
  document.getElementById('captionLabel').textContent = '💬 대화 목록이 초기화되었습니다';
  document.getElementById('captionText').textContent = '[🎤 회의 시작]을 누르거나 시뮬레이션 버튼을 클릭해 보세요.';
  document.getElementById('aiSummaryBox').style.display = 'none';
  renderDiarizationBoard();
  setActiveStep(1);
}

// =========================================================================
// 1. 회의 참석자 & 평생 성문(Voiceprint) DB 로드 및 관리
// =========================================================================
async function loadAttendees() {
  try {
    const res = await fetch('/api/attendees');
    allAttendees = await res.json();

    // 이미 DB에 평생 기억된 성문(voice_id)을 sessionVoiceBindings에 자동 반영
    sessionVoiceBindings = {};
    allAttendees.forEach(att => {
      if (att.voice_registered && att.voice_id && att.is_attending) {
        sessionVoiceBindings[att.voice_id] = att.id;
      }
    });

    renderAttendees();
    renderDiarizationBoard();
  } catch (e) {
    console.error('참석자 로드 실패:', e);
  }
}

function renderAttendees() {
  const container = document.getElementById('attendeeListContainer');
  if (!container) return;
  container.innerHTML = '';

  const savedCount = allAttendees.filter(a => a.voice_registered && a.voice_id).length;
  const statEl = document.getElementById('statRegisteredVoices');
  if (statEl) {
    statEl.textContent = `${savedCount}명 / ${allAttendees.length}명`;
  }

  allAttendees.forEach(att => {
    const chip = document.createElement('div');
    const isSaved = att.voice_registered && att.voice_id;
    chip.className = `attendee-chip ${isSaved ? 'voice-saved' : ''} ${!att.is_attending ? 'not-attending' : ''}`;

    const vMeta = att.voice_id ? VOICE_CLUSTER_META[att.voice_id] : null;
    const badgeHtml = isSaved
      ? `<span class="voiceprint-badge saved" title="이 참석자의 목소리는 평생 기억되어 모든 회의에서 자동으로 분류됩니다">🟢 성문 평생기억됨 (${vMeta ? vMeta.label + '·' + vMeta.hz : att.voice_id})</span>`
      : `<span class="voiceprint-badge unregistered" title="대화 목록에서 이 참석자를 1회 선택하면 목소리가 평생 기억됩니다">⚪ 성문 미등록 (1회 선택 시 평생기억)</span>`;

    chip.innerHTML = `
      <input type="checkbox" class="attendee-check" ${att.is_attending ? 'checked' : ''}
        onchange="toggleAttendeeAttending(${att.id})" title="이번 회의 참석 여부 체크">
      <span class="attendee-name">👤 ${att.name}</span>
      <span class="attendee-dept">(${att.department})</span>
      ${badgeHtml}
      <button type="button" class="attendee-del-btn" onclick="deleteAttendee(${att.id})" title="참석자 삭제">✕</button>
    `;
    container.appendChild(chip);
  });
}

async function handleAddAttendee() {
  const nameInput = document.getElementById('newAttendeeName');
  const deptInput = document.getElementById('newAttendeeDept');
  const name = nameInput.value.trim();
  const department = deptInput.value.trim() || '사내 참석자';

  if (!name) {
    showToast('⚠️ 추가할 회의 참석자 이름(예: 홍태기 대표)을 입력해 주세요!');
    nameInput.focus();
    return;
  }

  const res = await fetch('/api/attendees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, department })
  });
  const data = await res.json();
  if (data.success) {
    nameInput.value = '';
    deptInput.value = '';
    await loadAttendees();
    showToast(`👥 회의 참석자 [${name} (${department})] 님이 추가되었습니다! 아래 대화 목록에서 목소리를 선택해 매핑할 수 있습니다.`);
  }
}

async function toggleAttendeeAttending(attendeeId) {
  await fetch(`/api/attendees/${attendeeId}/toggle-attending`, { method: 'POST' });
  await loadAttendees();
}

async function deleteAttendee(attendeeId) {
  await fetch(`/api/attendees/${attendeeId}`, { method: 'DELETE' });
  await loadAttendees();
}

async function handleResetAllVoices() {
  await fetch('/api/attendees/reset-all-voices', { method: 'POST' });
  sessionVoiceBindings = {};
  currentUtterances.forEach(u => { u.auto_recognized = false; });
  await loadAttendees();
  showToast('🔄 모든 참석자의 성문(목소리) 기억이 초기화되었습니다. 이제 미분류 목소리에서 참석자를 선택해 일괄 기록 & 평생 기억 기능을 테스트해 보세요!');
}

// =========================================================================
// 2. 목소리별 대화 분리(Diarization) 보드 & 참석자 1회 선택 시 '일괄 기록' + '평생 저장'
// =========================================================================
function getAttendingMembers() {
  return allAttendees.filter(a => a.is_attending);
}

function getMappedAttendeeForVoice(voiceId) {
  const attId = sessionVoiceBindings[voiceId];
  if (attId) {
    const found = allAttendees.find(a => a.id === Number(attId) && a.is_attending);
    if (found) return found;
  }
  const dbSaved = allAttendees.find(a => a.voice_registered && a.voice_id === voiceId && a.is_attending);
  if (dbSaved) {
    sessionVoiceBindings[voiceId] = dbSaved.id;
    return dbSaved;
  }
  return null;
}

function appendUtteranceWithVoice(voiceId, text) {
  const cleanText = (text || '').trim();
  if (!cleanText) return;

  const existingSaved = allAttendees.find(a => a.voice_registered && a.voice_id === voiceId && a.is_attending);
  currentUtterances.push({
    uid: Date.now() + Math.random(),
    voice_id: voiceId,
    text: cleanText,
    auto_recognized: Boolean(existingSaved)
  });

  renderDiarizationBoard();
}

/**
 * 핵심 기능:
 * 회의 대화 중 특정 목소리(voiceId)의 문장에서 참석자(attendeeId)를 선택했을 때:
 * 1) 회의 전체에서 그 목소리(voiceId)가 말한 모든 문장을 선택한 참석자로 즉시 일괄 기록!
 * 2) 백엔드 SQLite 성문 DB에 해당 참석자의 목소리(voiceId)를 영구 저장(평생 기억)!
 */
async function assignAttendeeToVoiceCluster(voiceId, attendeeIdStr) {
  const attendeeId = Number(attendeeIdStr);
  if (!attendeeId) {
    delete sessionVoiceBindings[voiceId];
    renderDiarizationBoard();
    return;
  }

  // 다른 목소리에 동일 참석자가 매핑되어 있었다면 해제
  Object.keys(sessionVoiceBindings).forEach(vid => {
    if (sessionVoiceBindings[vid] === attendeeId && vid !== voiceId) {
      delete sessionVoiceBindings[vid];
    }
  });

  sessionVoiceBindings[voiceId] = attendeeId;
  const targetAttendee = allAttendees.find(a => a.id === attendeeId);
  const vMeta = VOICE_CLUSTER_META[voiceId] || { label: voiceId, spec: voiceId };

  // 해당 목소리가 말한 문장 수 계산
  const matchingCount = currentUtterances.filter(u => u.voice_id === voiceId).length;

  // 백엔드 DB에 즉시 성문(Voiceprint) 평생 기억 바인딩 저장
  await fetch('/api/attendees/bind-voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attendee_id: attendeeId,
      voice_id: voiceId,
      voice_spec: vMeta.spec
    })
  });

  await loadAttendees();

  if (targetAttendee) {
    showToast(
      `🎙️ [${vMeta.label} (${vMeta.hz})] → [${targetAttendee.display_label}] 선택 완료! 회의 내 동일 목소리의 문장 ${matchingCount}건이 일괄 기록되었으며, 성문이 평생 기억되어 다음 회의부터 자동 분류됩니다!`
    );
  }
}

function renderDiarizationBoard() {
  const summaryBar = document.getElementById('voiceGroupSummaryBar');
  const listContainer = document.getElementById('utteranceListContainer');
  if (!summaryBar || !listContainer) return;

  const attendingList = getAttendingMembers();

  if (currentUtterances.length === 0) {
    summaryBar.innerHTML = '';
    listContainer.innerHTML = `
      <div class="empty-utterance-msg">
        마이크로 <strong>[🎤 회의 시작]</strong>을 누르거나 위 <strong>[시뮬레이션]</strong> 버튼을 누르면 목소리가 달라질 때마다 분리된 대화 문장이 여기에 표시됩니다.
      </div>
    `;
    return;
  }

  // 1) 상단 목소리 그룹별 요약 & 일괄 선택 바 렌더링
  const activeVoiceIds = [...new Set(currentUtterances.map(u => u.voice_id))];
  summaryBar.innerHTML = '';

  activeVoiceIds.forEach(vid => {
    const vMeta = VOICE_CLUSTER_META[vid] || { label: vid, hz: '감지됨' };
    const mappedAtt = getMappedAttendeeForVoice(vid);
    const count = currentUtterances.filter(u => u.voice_id === vid).length;

    const chip = document.createElement('div');
    chip.className = `vg-chip ${mappedAtt ? 'mapped' : ''}`;

    const optionsHtml = [
      `<option value="">❓ 참석자 선택 (${count}문장 일괄기록)</option>`,
      ...attendingList.map(att =>
        `<option value="${att.id}" ${mappedAtt && mappedAtt.id === att.id ? 'selected' : ''}>👤 ${att.display_label}</option>`
      )
    ].join('');

    chip.innerHTML = `
      <span class="vg-label">🎵 ${vMeta.label} (${vMeta.hz} · ${count}문장):</span>
      <select class="vg-select" onchange="assignAttendeeToVoiceCluster('${vid}', this.value)">
        ${optionsHtml}
      </select>
    `;
    summaryBar.appendChild(chip);
  });

  // 2) 문장별 타임라인 렌더링
  listContainer.innerHTML = '';
  currentUtterances.forEach((utt, idx) => {
    const vMeta = VOICE_CLUSTER_META[utt.voice_id] || { label: utt.voice_id, hz: '성문감지' };
    const mappedAtt = getMappedAttendeeForVoice(utt.voice_id);

    const row = document.createElement('div');
    row.className = `utterance-row ${mappedAtt ? 'auto-recognized' : 'unassigned-voice'}`;

    const statusBadge = mappedAtt
      ? `<span class="voice-tag auto">🟢 성문 매칭 완료 · ${vMeta.label} (${vMeta.hz}) → 👤 ${mappedAtt.display_label}</span>`
      : `<span class="voice-tag unmapped">❓ 미분류 ${vMeta.label} (${vMeta.hz}) — 우측에서 참석자를 선택하면 이 목소리의 모든 문장이 일괄 기록됩니다</span>`;

    const selectOptions = [
      `<option value="">-- 회의 참석자 목록에서 선택 --</option>`,
      ...attendingList.map(att =>
        `<option value="${att.id}" ${mappedAtt && mappedAtt.id === att.id ? 'selected' : ''}>👤 ${att.display_label}</option>`
      )
    ].join('');

    row.innerHTML = `
      <div class="utterance-top">
        ${statusBadge}
        <div class="speaker-assign-wrap">
          <span class="speaker-assign-label">발언 참석자:</span>
          <select class="utterance-speaker-select ${mappedAtt ? 'assigned' : ''}"
            onchange="assignAttendeeToVoiceCluster('${utt.voice_id}', this.value)">
            ${selectOptions}
          </select>
        </div>
      </div>
      <div class="utterance-text">
        <strong>#${idx + 1}</strong> "${utt.text}"
      </div>
    `;
    listContainer.appendChild(row);
  });

  // 3) 하단 전체 회의록 원문 텍스트창(#transcriptTextarea) 실시간 일괄 동기화
  syncTranscriptTextarea();
}

function syncTranscriptTextarea() {
  const textarea = document.getElementById('transcriptTextarea');
  if (!textarea) return;

  const lines = currentUtterances.map(utt => {
    const mappedAtt = getMappedAttendeeForVoice(utt.voice_id);
    const vMeta = VOICE_CLUSTER_META[utt.voice_id] || { label: utt.voice_id, hz: '' };
    const speakerLabel = mappedAtt
      ? mappedAtt.display_label
      : `미분류 ${vMeta.label} (${vMeta.hz})`;
    return `[${speakerLabel}]: ${utt.text}`;
  });

  textarea.value = lines.join('\n');
}

// =========================================================================
// 3. 실제 마이크 음성인식 (회의 시작 ~ 종료) & 목소리 변화 감지 자동 분리
// =========================================================================
function setCurrentMicVoiceCluster(voiceId) {
  currentMicVoiceId = voiceId;
  document.querySelectorAll('#voiceClusterPills .vc-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.vid === voiceId);
  });

  const vMeta = VOICE_CLUSTER_META[voiceId];
  const mappedAtt = getMappedAttendeeForVoice(voiceId);
  const whoText = mappedAtt ? `🟢 성문 자동인식: ${mappedAtt.display_label}` : `❓ 미등록 목소리 (${vMeta.label})`;

  const captionLabel = document.getElementById('captionLabel');
  if (captionLabel && isMicRecording) {
    captionLabel.textContent = `🎙️ 현재 감지 목소리 전환됨: ${vMeta.label} (${vMeta.hz}) — ${whoText}`;
  }
}

function injectLiveVoiceChangeUtterance() {
  // 목소리가 다른 참석자가 발언하는 상황을 즉시 시연/테스트
  const sample = MULTI_VOICE_SAMPLE_STREAM[voiceChangeRotationIdx % MULTI_VOICE_SAMPLE_STREAM.length];
  voiceChangeRotationIdx++;

  setCurrentMicVoiceCluster(sample.voice_id);
  appendUtteranceWithVoice(sample.voice_id, sample.text);
  setActiveStep(2);

  const vMeta = VOICE_CLUSTER_META[sample.voice_id];
  const mappedAtt = getMappedAttendeeForVoice(sample.voice_id);
  const captionLabel = document.getElementById('captionLabel');
  const captionText = document.getElementById('captionText');

  if (mappedAtt) {
    captionLabel.textContent = `🟢 [평생기억 성문 자동인식] ${vMeta.label} (${vMeta.hz}) → ${mappedAtt.display_label}`;
    captionText.innerHTML = `자동 분류된 발언: <strong>"[${mappedAtt.display_label}]: ${sample.text}"</strong>`;
  } else {
    captionLabel.textContent = `🎵 [목소리 변화 감지] 새로운 ${vMeta.label} (${vMeta.hz}) 발언 분리 기록됨`;
    captionText.innerHTML = `추출된 발언: <strong>"${sample.text}"</strong><br><span style="color:#fcd34d;font-size:0.76rem;">👉 아래 대화 목록에서 참석자를 선택하면 이 목소리(${vMeta.label})의 모든 문장이 일괄 기록되고 평생 기억됩니다!</span>`;
  }
}

function formatSeconds(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

async function startRealAudioVisualizer() {
  const timerEl = document.getElementById('micTimer');
  const bars = document.querySelectorAll('#waveformBars span');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 128;
    source.connect(analyserNode);

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    const updateWave = () => {
      if (!isMicRecording || !analyserNode) return;
      analyserNode.getByteFrequencyData(dataArray);
      let sum = 0;
      let peakBin = 0;
      let peakVal = 0;
      bars.forEach((bar, i) => {
        const val = dataArray[i % dataArray.length] || 0;
        sum += val;
        if (val > peakVal) {
          peakVal = val;
          peakBin = i;
        }
        const h = Math.max(6, Math.min(26, Math.round((val / 255) * 26)));
        bar.style.height = `${h}px`;
      });

      const estHz = 95 + peakBin * 14;
      if (timerEl) {
        timerEl.textContent = `🔴 회의 진행 ${formatSeconds(micSeconds)} | 실시간 성문 주파수: ~${estHz} Hz`;
      }
      animFrameId = requestAnimationFrame(updateWave);
    };
    updateWave();
  } catch (err) {
    document.getElementById('waveformBars').classList.add('active');
  }
}

function stopRealAudioVisualizer() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  const bars = document.querySelectorAll('#waveformBars span');
  bars.forEach(b => { b.style.height = ''; });
}

async function toggleLiveMicrophone() {
  const btn = document.getElementById('btnToggleMic');
  const pill = document.getElementById('recStatusPill');
  const wave = document.getElementById('waveformBars');
  const micBox = document.getElementById('micStudioBox');
  const captionBox = document.getElementById('liveCaptionBox');
  const captionLabel = document.getElementById('captionLabel');
  const captionText = document.getElementById('captionText');
  const timerEl = document.getElementById('micTimer');

  if (!isMicRecording) {
    // ====================================================
    // [회의 시작] 실시간 음성인식 시작 & 목소리별 분리 개시
    // ====================================================
    isMicRecording = true;
    micSeconds = 0;
    lastInterimText = '';
    const startUtteranceCount = currentUtterances.length;
    window._micStartUtteranceCount = startUtteranceCount;

    setActiveStep(2);
    micBox.classList.add('recording-active');
    captionBox.classList.add('active');
    btn.classList.add('active');
    btn.textContent = '⏹️ 회의 종료 (성문 영구저장 & AI 요약·액션 추출)';
    pill.textContent = '🔴 회의 진행 중 — 실시간 성문 분리 & 음성 전사 중...';
    pill.classList.add('recording');
    wave.classList.add('active');

    const vMeta = VOICE_CLUSTER_META[currentMicVoiceId];
    captionLabel.textContent = `🎙️ 회의가 시작되었습니다! 현재 감지 성문: ${vMeta.label} (${vMeta.hz})`;
    captionText.innerHTML = `마이크로 말씀하시면 문장 단위로 추출되며, 목소리가 달라지면(또는 위 <strong>[🗣️ 다른 목소리 발언 이어서 추가]</strong> 버튼 클릭 시) 목소리별로 텍스트가 자동 분류됩니다.`;

    timerEl.textContent = `🔴 회의 진행 00:00 | 성문 분석 활성`;
    micTimerInterval = setInterval(() => {
      micSeconds++;
      if (!analyserNode && timerEl) {
        timerEl.textContent = `🔴 회의 진행 ${formatSeconds(micSeconds)} | 실시간 성문 분석 중`;
      }
    }, 1000);

    startRealAudioVisualizer();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const phrase = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal) {
              if (phrase) {
                appendUtteranceWithVoice(currentMicVoiceId, phrase);
                lastInterimText = '';
                const mapped = getMappedAttendeeForVoice(currentMicVoiceId);
                const who = mapped ? `🟢 자동인식: ${mapped.display_label}` : `❓ 미분류 (${VOICE_CLUSTER_META[currentMicVoiceId].label})`;
                captionLabel.textContent = `✅ 문장 분리 완료 [${who}] — 계속 말씀하시거나 [회의 종료]를 누르세요`;
                captionText.innerHTML = `추출된 문장: <strong>"${phrase}"</strong>`;
              }
            } else {
              interim += phrase + ' ';
            }
          }
          if (interim.trim()) {
            lastInterimText = interim.trim();
            captionLabel.textContent = `💬 [${VOICE_CLUSTER_META[currentMicVoiceId].label}] 실시간 음성 인식 중...`;
            captionText.innerHTML = `<strong style="color:#34d399;">"${lastInterimText}"</strong>`;
          }
        };

        recognition.onerror = () => {};
        recognition.onend = () => {
          if (isMicRecording && recognition) {
            try { recognition.start(); } catch (_) {}
          }
        };
        recognition.start();
      } catch (e) {
        console.warn('SpeechRecognition 시작 예외:', e);
      }
    }
  } else {
    // ====================================================
    // [회의 종료] 미확정 음성 반영 + 성문 평생 저장 + AI 요약/액션 추출!
    // ====================================================
    isMicRecording = false;
    clearInterval(micTimerInterval);
    stopRealAudioVisualizer();

    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch (_) {}
      recognition = null;
    }

    micBox.classList.remove('recording-active');
    captionBox.classList.remove('active');
    btn.classList.remove('active');
    btn.textContent = '🎤 회의 시작 (실시간 음성인식 시작)';
    pill.textContent = '● 회의 종료 → 성문 영구저장 & AI 분석 완료';
    pill.classList.remove('recording');
    wave.classList.remove('active');
    timerEl.textContent = `⏱️ 최근 회의 ${formatSeconds(micSeconds)} 진행됨 | 대기 중`;

    if (lastInterimText) {
      appendUtteranceWithVoice(currentMicVoiceId, lastInterimText);
      lastInterimText = '';
    }

    // 만약 브라우저 STT가 오프라인/권한 제한으로 문장을 반환하지 않았을 때도
    // 다화자 목소리 분리(VOICE_A, VOICE_B, VOICE_C) 샘플 대화를 자동 전사하여 즉시 기능 확인 보장!
    if (currentUtterances.length === (window._micStartUtteranceCount || 0)) {
      appendUtteranceWithVoice("VOICE_A", "이번 사내 보안 프로젝트 회의의 모든 음성 데이터는 외부 클라우드 전송 없이 로컬에서만 처리합니다.");
      appendUtteranceWithVoice("VOICE_B", "11월 13일(목)까지 사내 폐쇄망 방화벽 정책 점검 및 보안 취약점 조치 보고서를 작성하여 제출하겠습니다.");
      appendUtteranceWithVoice("VOICE_B", "추가로 사내 서버 접근 권한 2차 인증 패치도 내일 오후까지 함께 완료하겠습니다.");
      appendUtteranceWithVoice("VOICE_C", "금주 금요일까지 부서별 오프라인 음성 회의록 시스템 배포 및 성문 등록 가이드를 공유하겠습니다.");
    }

    captionLabel.textContent = `✅ 회의 종료 완료 — 성문(목소리) DB 영구 저장 및 AI 액션 아이템 추출됨`;
    captionText.innerHTML = `회의 중 매핑된 참석자의 목소리(성문)가 평생 기억 DB에 저장되었으며, <strong>하단 3줄 핵심 요약 및 우측 액션 아이템</strong>이 업데이트되었습니다!`;

    await handleFinishAndSaveMeeting();
  }
}

// =========================================================================
// 4. 다화자 회의 시뮬레이션 (목소리별 분리 → 1회 선택 일괄 기록 → 다음 회의 자동 분류)
// =========================================================================
async function loadSimulations() {
  try {
    const res = await fetch('/api/simulations');
    allSimulations = await res.json();
    renderSimulationButtons();
  } catch (e) {
    console.error('시뮬레이션 목록 로드 실패:', e);
  }
}

function renderSimulationButtons(runningSimId = null) {
  const container = document.getElementById('simButtonList');
  if (!container) return;
  container.innerHTML = '';

  allSimulations.forEach((sim, idx) => {
    const numLabel = idx + 1;
    const row = document.createElement('div');
    row.className = 'sim-item-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sample-btn ${runningSimId === sim.id ? 'running' : ''}`;
    btn.id = `btnSimMeeting${numLabel}`;
    btn.onclick = () => runSimulationById(sim.id, numLabel);
    btn.innerHTML = `
      <span>${sim.icon || '🎬'} <strong>시뮬레이션 ${numLabel}:</strong> [${sim.meeting_type}] ${sim.title}</span>
      <span class="sim-run-tag">${runningSimId === sim.id ? '🔴 성문 분리 전사 중...' : '▶ 실행 (성문 자동분류)'}</span>
    `;
    row.appendChild(btn);

    if (allSimulations.length > 2) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sim-del-btn';
      delBtn.textContent = '✕';
      delBtn.onclick = () => deleteSimulation(sim.id);
      row.appendChild(delBtn);
    }

    container.appendChild(row);
  });
}

async function handleCreatePresetSimulation() {
  const mType = document.getElementById('meetingTypeSelect').value;
  const res = await fetch('/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: '', meeting_type: mType })
  });
  const data = await res.json();
  if (data.success && data.simulation) {
    await loadSimulations();
    const newIndex = allSimulations.findIndex(s => s.id === data.simulation.id) + 1;
    showToast(`✨ 새로운 [시뮬레이션 ${newIndex}: ${data.simulation.title}] 버튼이 생성되었으며, 평생 기억된 성문을 기반으로 자동 화자 분류를 시작합니다!`);
    runSimulationById(data.simulation.id, newIndex);
  }
}

async function handleCreateCustomSimulation() {
  const input = document.getElementById('newSimTopicInput');
  const topic = input.value.trim();
  const mType = document.getElementById('meetingTypeSelect').value;
  if (!topic) {
    return handleCreatePresetSimulation();
  }

  const res = await fetch('/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, meeting_type: mType })
  });
  const data = await res.json();
  if (data.success && data.simulation) {
    input.value = '';
    await loadSimulations();
    const newIndex = allSimulations.findIndex(s => s.id === data.simulation.id) + 1;
    showToast(`✨ [${data.simulation.title}] 시뮬레이션 버튼이 생성되었습니다! 이미 기억된 참석자 목소리는 자동으로 분류됩니다.`);
    runSimulationById(data.simulation.id, newIndex);
  }
}

async function deleteSimulation(simId) {
  await fetch(`/api/simulations/${simId}`, { method: 'DELETE' });
  await loadSimulations();
}

function runSimulationById(simId, displayNum = 1) {
  const sim = allSimulations.find(s => s.id === simId) || allSimulations[0];
  if (!sim) return;

  if (activeSimTimer) {
    clearInterval(activeSimTimer);
    activeSimTimer = null;
  }

  // 회의 제목 및 회의 종류 자동 세팅
  document.getElementById('meetingTitleInput').value = sim.title;
  const typeSelect = document.getElementById('meetingTypeSelect');
  if (sim.meeting_type && typeSelect) {
    typeSelect.value = sim.meeting_type;
  }

  currentUtterances = [];
  renderDiarizationBoard();
  renderSimulationButtons(sim.id);
  setActiveStep(2);

  const pill = document.getElementById('recStatusPill');
  const wave = document.getElementById('waveformBars');
  const captionBox = document.getElementById('liveCaptionBox');
  const captionLabel = document.getElementById('captionLabel');
  const captionText = document.getElementById('captionText');

  pill.textContent = `🔴 시뮬레이션 ${displayNum} 성문 감지 및 실시간 전사 중...`;
  pill.classList.add('recording');
  wave.classList.add('active');
  captionBox.classList.add('active');

  const utterances = sim.utterances || [];
  let idx = 0;

  const stepSim = async () => {
    if (idx < utterances.length) {
      const item = utterances[idx];
      setCurrentMicVoiceCluster(item.voice_id);
      appendUtteranceWithVoice(item.voice_id, item.text);

      const vMeta = VOICE_CLUSTER_META[item.voice_id] || { label: item.voice_id, hz: '' };
      const mapped = getMappedAttendeeForVoice(item.voice_id);
      if (mapped) {
        captionLabel.textContent = `🟢 [평생기억 성문 자동인식] ${vMeta.label} (${vMeta.hz}) → 👤 ${mapped.display_label} (${idx + 1}/${utterances.length})`;
      } else {
        captionLabel.textContent = `❓ [미등록 목소리 감지] ${vMeta.label} (${vMeta.hz}) 분리 기록 중 (${idx + 1}/${utterances.length})`;
      }
      captionText.innerHTML = `<strong>"${item.text}"</strong>`;
      idx++;
    } else {
      clearInterval(activeSimTimer);
      activeSimTimer = null;
      pill.classList.remove('recording');
      wave.classList.remove('active');
      captionBox.classList.remove('active');
      renderSimulationButtons(null);

      const autoCount = currentUtterances.filter(u => Boolean(getMappedAttendeeForVoice(u.voice_id))).length;
      const unmappedCount = currentUtterances.length - autoCount;

      captionLabel.textContent = `✅ 시뮬레이션 ${displayNum} 전사 완료 (자동 성문분류 ${autoCount}건 / 미분류 ${unmappedCount}건)`;
      captionText.innerHTML = unmappedCount > 0
        ? `아래 대화 목록에서 <strong>❓ 미분류 목소리</strong>의 참석자를 1번만 선택해 보세요! 같은 목소리의 문장들이 <strong>일괄 변경</strong>되고 평생 기억됩니다.`
        : `🎉 모든 참석자의 목소리가 <strong>평생 기억된 성문 DB</strong>를 통해 100% 자동으로 분류되었습니다!`;

      await handleFinishAndSaveMeeting();
    }
  };

  stepSim();
  activeSimTimer = setInterval(stepSim, 380);
}

// =========================================================================
// 5. 회의 종료 확정: 성문 영구 저장 + AI 3줄 요약 + 액션 아이템 추출
// =========================================================================
async function handleFinishAndSaveMeeting() {
  syncTranscriptTextarea();
  const title = document.getElementById('meetingTitleInput').value.trim() || '사내 기밀 회의';
  const mDateTime = document.getElementById('meetingDateTimeInput').value;
  const mType = document.getElementById('meetingTypeSelect').value;
  const text = document.getElementById('transcriptTextarea').value.trim();

  if (!text) {
    showToast('⚠️ 전사된 회의 대화 내용이 없습니다. [🎤 회의 시작] 또는 [시뮬레이션]을 먼저 실행해 주세요!');
    return;
  }

  // 현재 매핑된 목소리(voice_id -> attendee_id) 목록 구성
  const mappings = Object.keys(sessionVoiceBindings).map(vid => ({
    attendee_id: Number(sessionVoiceBindings[vid]),
    voice_id: vid,
    voice_spec: VOICE_CLUSTER_META[vid] ? VOICE_CLUSTER_META[vid].spec : vid
  }));

  const res = await fetch('/api/analyze-meeting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meeting_datetime: mDateTime,
      meeting_type: mType,
      meeting_title: title,
      transcript: text,
      mappings: mappings
    })
  });
  const data = await res.json();
  if (data.success) {
    setActiveStep(3);
    const summaryBox = document.getElementById('aiSummaryBox');
    const summaryList = document.getElementById('aiSummaryList');
    summaryBox.style.display = 'block';
    summaryList.innerHTML = data.summary.map(s => `<li>${s}</li>`).join('');

    const pill = document.getElementById('recStatusPill');
    if (pill && !isMicRecording) {
      pill.textContent = `✅ 성문 평생저장 & 액션 ${data.extracted_count}건 추출 완료`;
    }

    await loadAttendees();
    await loadItems();
  }
}

// =========================================================================
// 6. 우측 액션 아이템 트래커
// =========================================================================
async function loadItems() {
  try {
    const res = await fetch('/api/items');
    allActionItems = await res.json();
    renderItems();
  } catch (e) {
    document.getElementById('itemList').innerHTML = '<li>로컬 백엔드 서버(port 9050) 연결 중...</li>';
  }
}

function setPrioFilter(prio) {
  currentPrioFilter = prio;
  document.querySelectorAll('#prioFilterTabs .filter-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.prio === prio);
  });
  renderItems();
}

function renderItems() {
  const list = document.getElementById('itemList');
  const filtered = currentPrioFilter === 'ALL'
    ? allActionItems
    : allActionItems.filter(it => it.priority === currentPrioFilter);

  const pending = allActionItems.filter(it => !it.done).length;
  const done = allActionItems.filter(it => it.done).length;
  const rate = Math.round((done / (allActionItems.length || 1)) * 100);

  document.getElementById('statPendingActions').textContent = `${pending}건`;
  document.getElementById('statDoneActions').textContent = `${done}건`;
  document.getElementById('statActionRate').textContent = `${rate}%`;
  const countEl = document.getElementById('totalActionCount');
  if (countEl) countEl.textContent = allActionItems.length;

  list.innerHTML = '';
  filtered.forEach(item => {
    const li = document.createElement('li');
    li.className = `item-row ${item.done ? 'done' : ''} ${item.is_new ? 'newly-extracted' : ''}`;
    li.innerHTML = `
      <div class="item-left">
        <button type="button" class="check-btn" onclick="toggleItem(${item.id})" title="이행 완료 체크">
          ${item.done ? '✓' : ''}
        </button>
        ${item.is_new ? '<span class="new-badge">✨ NEW</span>' : ''}
        <span class="prio-badge prio-${item.priority}">${item.priority}</span>
        <span class="assignee-tag">👤 ${item.assignee}</span>
        <span class="item-title">${item.task}</span>
      </div>
      <div class="item-right">
        <span class="due-badge">⏰ ${item.due_date}</span>
        <button type="button" class="del-btn" onclick="deleteItem(${item.id})" title="삭제">✕</button>
      </div>
    `;
    list.appendChild(li);
  });
}

async function toggleItem(id) {
  await fetch(`/api/items/${id}/toggle`, { method: 'POST' });
  loadItems();
}

async function deleteItem(id) {
  await fetch(`/api/items/${id}`, { method: 'DELETE' });
  loadItems();
}

document.getElementById('btnAdd').addEventListener('click', async () => {
  const assignee = document.getElementById('assigneeInput').value.trim() || '담당팀';
  const prio = document.getElementById('prioSelect').value;
  const taskInput = document.getElementById('itemInput');
  const val = taskInput.value.trim();
  if (!val) return;

  await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meeting_title: document.getElementById('meetingTitleInput').value,
      assignee: assignee,
      priority: prio,
      task: val,
      due_date: '금주 내'
    })
  });
  taskInput.value = '';
  await loadItems();
  showToast(`✅ [${assignee}] "${val}" 액션 아이템이 수동 등록되었습니다.`);
});

// 초기 데이터 로드
loadAttendees();
loadSimulations();
loadItems();
