import { rooms, entryRoom, roomStates, scenes, appState, applyRules } from './state.js';

// Feature 1: Live IoT Simulator
// Feature 3: Emergency Safety & Siren Alarm (Smoke/Gas, Water Leak, Away Motion Intrusion)
// Feature 4: Scheduled Automation with Virtual Clock

const SCHEDULE_KEY = 'smart-home-control-schedules';

const defaultSchedules = [
  { id: 'morning-wake', time: '07:00', action: 'morning', label: 'Таңғы ояну (перделерді ашу, шамды өшіру)', enabled: true },
  { id: 'evening-light', time: '19:30', action: 'evening', label: 'Кешкі жайлылық (қонақ пен асхана шамын қосу)', enabled: true },
  { id: 'night-mode', time: '23:00', action: 'night', label: 'Түнгі режим (есікті құлыптау, жарықты 15% ету)', enabled: true }
];

let audioCtx;
let sirenTimer = 0;

function playSirenBeep() {
  if (appState.sirenMuted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(660, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(920, audioCtx.currentTime + 0.22);
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.29);
  } catch {}
}

function startSirenAudio() {
  stopSirenAudio();
  playSirenBeep();
  sirenTimer = window.setInterval(() => {
    if (!appState.emergencyActive) {
      stopSirenAudio();
      return;
    }
    playSirenBeep();
  }, 1300);
}

function stopSirenAudio() {
  if (sirenTimer) {
    clearInterval(sirenTimer);
    sirenTimer = 0;
  }
}

export function initSmartFeatures({ logAndRefresh, renderDevices, selectRoom, triggerSceneByKey, notifyAssistant }) {
  // --- Emergency & Safety (Feature 3) ---
  const banner = document.querySelector('#emergency-banner');
  const bannerTitle = document.querySelector('#emergency-title');
  const bannerDetail = document.querySelector('#emergency-detail');
  const muteButton = document.querySelector('#emergency-mute');
  const resetButton = document.querySelector('#emergency-reset');

  const smokeValue = document.querySelector('#safety-smoke-val');
  const waterValue = document.querySelector('#safety-water-val');
  const motionValue = document.querySelector('#safety-motion-val');
  const smokeCard = document.querySelector('#safety-smoke-card');
  const waterCard = document.querySelector('#safety-water-card');
  const motionCard = document.querySelector('#safety-motion-card');
  const safetyStatus = document.querySelector('#safety-status');

  function triggerEmergency(reason, detail, roomIdx) {
    appState.emergencyActive = true;
    appState.emergencyReason = reason;
    banner.hidden = false;
    bannerTitle.textContent = 'АПАТТЫҚ ДАБЫЛ: ' + reason;
    bannerDetail.textContent = detail;
    startSirenAudio();
    notifyAssistant?.('🚨 АПАТТЫҚ ДАБЫЛ: ' + reason + '. ' + detail);
    if (typeof roomIdx === 'number') selectRoom(roomIdx);
    renderDevices();
  }

  function resetEmergency() {
    appState.emergencyActive = false;
    appState.emergencyReason = '';
    roomStates.forEach(r => {
      r.smoke = Math.min(r.smoke, 12);
      r.waterLeak = false;
      r.motion = false;
    });
    banner.hidden = true;
    stopSirenAudio();
    safetyStatus.textContent = 'Барлық қауіпсіздік датчиктері қалыпты күйде.';
    logAndRefresh(appState.selectedRoom, 'Қауіпсіздік дабылы қалпына келтірілді');
    renderDevices();
  }

  muteButton.addEventListener('click', () => {
    appState.sirenMuted = !appState.sirenMuted;
    muteButton.textContent = appState.sirenMuted ? 'Дыбысты қосу' : 'Дыбысты өшіру';
    if (appState.sirenMuted) stopSirenAudio();
    else if (appState.emergencyActive) startSirenAudio();
  });

  resetButton.addEventListener('click', resetEmergency);

  // Test emergency buttons
  document.querySelector('#sim-smoke-btn').addEventListener('click', () => {
    const kitchen = 2; // Асхана
    const room = roomStates[kitchen];
    room.smoke = 85;
    // Emergency protocol: cut all sockets & heaters, unlock doors for evacuation, turn on lights & cameras
    roomStates.forEach(r => {
      r.socket = false;
      r.heater = false;
      r.ac = false;
      r.lock = false;
      r.light = true;
      r.brightness = 100;
      r.camera = true;
    });
    logAndRefresh(kitchen, '🚨 Түтін/газ анықталды (85 ppm) · Розеткалар өшіріліп, есік құлпы ашылды');
    triggerEmergency(
      'Асханада түтін мен газ деңгейі қауіпті (85 ppm)!',
      'Барлық розеткалар мен жылытқыштар автоматты өшірілді, эвакуация үшін есік құлпы ашылды, жарық 100% қосылды.',
      kitchen
    );
  });

  document.querySelector('#sim-water-btn').addEventListener('click', () => {
    const kitchen = 2;
    roomStates[kitchen].waterLeak = true;
    roomStates[kitchen].socket = false;
    logAndRefresh(kitchen, '🚨 Су ағу датчигі іске қосылды · Розетка өшірілді');
    triggerEmergency(
      'Асханада су ағу анықталды!',
      'Қысқа тұйықталудың алдын алу үшін бөлмедегі розетка автоматты түрде өшірілді.',
      kitchen
    );
  });

  document.querySelector('#sim-motion-btn').addEventListener('click', () => {
    const entry = entryRoom;
    roomStates[entry].motion = true;
    roomStates[entry].camera = true;
    roomStates[entry].light = true;
    roomStates[entry].brightness = 100;
    if (appState.awayArmed) {
      roomStates.forEach(r => { r.lock = true; if (Object.hasOwn(r, 'door')) r.door = false; });
      logAndRefresh(entry, '🚨 Күзет дабылы: Кіреберісте бөгде қозғалыс!');
      triggerEmergency(
        'Күзет режимінде кіреберісте қозғалыс байқалды!',
        'Камера бейнежазбаны бастады, жарық қосылды және барлық есіктер құлыпталды.',
        entry
      );
    } else {
      safetyStatus.textContent = 'Кіреберісте қозғалыс тіркелді: дәліз шамы мен камера қосылды («Үйден шығу» режимінде дабыл қосылады).';
      logAndRefresh(entry, 'Қозғалыс датчигі · Камера мен шам қосылды');
      selectRoom(entry);
      renderDevices();
    }
  });

  function updateSafetyReadouts() {
    const room = roomStates[appState.selectedRoom];
    const smokeDanger = room.smoke >= 50;
    smokeValue.textContent = Math.round(room.smoke) + ' ppm';
    waterValue.textContent = room.waterLeak ? 'Су ағу бар!' : 'Құрғақ (Қалыпты)';
    motionValue.textContent = room.motion ? 'Қозғалыс бар!' : (appState.awayArmed ? 'Күзетте (Тыныш)' : 'Тыныш');

    smokeCard.classList.toggle('danger', smokeDanger);
    waterCard.classList.toggle('danger', Boolean(room.waterLeak));
    motionCard.classList.toggle('danger', Boolean(room.motion && appState.awayArmed));
  }

  // --- Live IoT Simulator (Feature 1) ---
  const liveToggleBtn = document.querySelector('#live-sim-toggle');
  const liveSpeedSelect = document.querySelector('#live-sim-speed');
  const liveBadge = document.querySelector('#live-badge');
  const liveStatusText = document.querySelector('#live-sim-status');
  let liveInterval = 0;
  let liveRunning = false;

  function stepLiveSimulation() {
    const virtualHour = Math.floor(virtualMinutes / 60);
    const isDaylight = virtualHour >= 7 && virtualHour <= 19;
    const outdoorTemp = isDaylight ? 26 : 16;
    const outdoorLux = isDaylight ? 520 : 25;

    roomStates.forEach((room, idx) => {
      // Natural drift + HVAC physics
      let tempDelta = (outdoorTemp - room.air) * 0.08 + (Math.random() - 0.5) * 0.6;
      if (room.ac) tempDelta -= 0.75;
      if (room.heater) tempDelta += 0.85;
      room.air = Number(Math.max(12, Math.min(42, room.air + tempDelta)).toFixed(1));

      let humDelta = (Math.random() - 0.48) * 1.8 + (room.ac ? -0.6 : 0);
      room.humidity = Math.max(22, Math.min(88, Math.round(room.humidity + humDelta)));

      const curtainFactor = room.curtain ? 1 : 0.22;
      const lampLux = room.light ? Math.round(room.brightness * 2.4) : 0;
      const targetLux = Math.round(outdoorLux * curtainFactor + lampLux + (Math.random() - 0.5) * 18);
      room.lux = Math.max(5, Math.min(1800, Math.round(room.lux * 0.45 + targetLux * 0.55)));

      // Subtle smoke baseline fluctuation if not in emergency
      if (!appState.emergencyActive) {
        room.smoke = Math.max(3, Math.min(25, Math.round(room.smoke + (Math.random() - 0.5) * 3)));
      }

      applyRules(room);
      logAndRefresh(idx, 'Тірі телеметрия', true);
    });

    const cur = roomStates[appState.selectedRoom];
    liveStatusText.textContent =
      'Соңғы жаңарту: ' + rooms[appState.selectedRoom] + ' · ' + cur.air + ' °C, ' + cur.humidity + '%, ' + cur.lux + ' лк';
    renderDevices();
  }

  function setLiveSimulation(enable) {
    liveRunning = enable;
    if (liveInterval) {
      clearInterval(liveInterval);
      liveInterval = 0;
    }
    liveToggleBtn.setAttribute('aria-pressed', String(liveRunning));
    liveToggleBtn.textContent = liveRunning ? 'Симуляцияны тоқтату' : 'Тірі симуляцияны қосу';
    liveBadge.dataset.active = String(liveRunning);
    liveBadge.querySelector('span').textContent = liveRunning ? 'Тірі IoT желіде' : 'Демо режимі';
    if (liveRunning) {
      const ms = Number(liveSpeedSelect.value) || 3500;
      stepLiveSimulation();
      liveInterval = window.setInterval(stepLiveSimulation, ms);
    } else {
      liveStatusText.textContent = 'Тірі симуляция уақытша тоқтатылған.';
    }
  }

  liveToggleBtn.addEventListener('click', () => setLiveSimulation(!liveRunning));
  liveSpeedSelect.addEventListener('change', () => {
    if (liveRunning) setLiveSimulation(true);
  });

  // --- Scheduled Automation & Virtual Clock (Feature 4) ---
  const clockEl = document.querySelector('#virtual-clock');
  const clockSpeedSelect = document.querySelector('#clock-speed');
  const scheduleForm = document.querySelector('#schedule-form');
  const scheduleListEl = document.querySelector('#schedule-list');
  const scheduleStatus = document.querySelector('#schedule-status');

  const now = new Date();
  let virtualMinutes = now.getHours() * 60 + now.getMinutes();
  let lastTriggeredMinute = -1;
  let clockTimer = 0;

  function loadSchedules() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCHEDULE_KEY));
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
    return structuredClone(defaultSchedules);
  }

  let schedules = loadSchedules();

  function persistSchedules() {
    try {
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
    } catch {}
  }

  function formatVirtualTime(mins) {
    const normalized = ((mins % 1440) + 1440) % 1440;
    const h = String(Math.floor(normalized / 60)).padStart(2, '0');
    const m = String(normalized % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  function executeScheduledRule(rule) {
    if (rule.action === 'morning') {
      appState.awayArmed = false;
      roomStates.forEach((r, idx) => {
        r.curtain = true;
        r.curtainLevel = 100;
        r.light = false;
        logAndRefresh(idx, 'Кесте (' + rule.time + ') · Таңғы ояну', true);
      });
      renderDevices();
    } else if (rule.action === 'evening') {
      [0, 2].forEach(idx => {
        roomStates[idx].light = true;
        roomStates[idx].brightness = 80;
        logAndRefresh(idx, 'Кесте (' + rule.time + ') · Кешкі жарық', true);
      });
      renderDevices();
    } else if (rule.action === 'night' || rule.action === 'away' || rule.action === 'movie') {
      triggerSceneByKey(rule.action, 'Кесте (' + rule.time + ') · ' + scenes[rule.action].name);
    }
    scheduleStatus.textContent = '⏰ ' + rule.time + ' ережесі орындалды: ' + rule.label;
  }

  function tickClock() {
    const step = Number(clockSpeedSelect.value);
    if (step === 0) {
      const real = new Date();
      virtualMinutes = real.getHours() * 60 + real.getMinutes();
    } else {
      virtualMinutes = (virtualMinutes + step) % 1440;
    }
    const hhmm = formatVirtualTime(virtualMinutes);
    clockEl.textContent = hhmm;

    if (virtualMinutes !== lastTriggeredMinute) {
      lastTriggeredMinute = virtualMinutes;
      schedules.forEach(rule => {
        if (rule.enabled && rule.time === hhmm) executeScheduledRule(rule);
      });
    }
  }

  function restartClockTimer() {
    if (clockTimer) clearInterval(clockTimer);
    const step = Number(clockSpeedSelect.value);
    const intervalMs = step === 0 ? 5000 : 1000;
    clockEl.textContent = formatVirtualTime(virtualMinutes);
    clockTimer = window.setInterval(tickClock, intervalMs);
  }

  clockSpeedSelect.addEventListener('change', restartClockTimer);
  document.querySelector('#clock-jump-btn').addEventListener('click', () => {
    // Jump to the next enabled schedule time to demonstrate immediately
    const enabled = schedules.filter(s => s.enabled);
    if (!enabled.length) return;
    const sorted = enabled
      .map(s => {
        const [h, m] = s.time.split(':').map(Number);
        return { rule: s, mins: h * 60 + m };
      })
      .sort((a, b) => a.mins - b.mins);
    const next = sorted.find(item => item.mins > virtualMinutes) || sorted[0];
    virtualMinutes = next.mins;
    clockEl.textContent = formatVirtualTime(virtualMinutes);
    lastTriggeredMinute = virtualMinutes;
    executeScheduledRule(next.rule);
  });

  function renderSchedules() {
    scheduleListEl.replaceChildren();
    schedules.forEach(rule => {
      const row = document.createElement('div');
      row.className = 'schedule-item';

      const info = document.createElement('div');
      const timeTag = document.createElement('time');
      timeTag.textContent = rule.time;
      const span = document.createElement('span');
      span.textContent = ' — ' + rule.label;
      info.append(timeTag, span);

      const actions = document.createElement('div');
      actions.className = 'schedule-item-actions';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = Boolean(rule.enabled);
      toggle.setAttribute('aria-label', rule.time + ' ережесін қосу');
      toggle.addEventListener('change', () => {
        rule.enabled = toggle.checked;
        persistSchedules();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'schedule-remove';
      removeBtn.textContent = 'Өшіру';
      removeBtn.addEventListener('click', () => {
        schedules = schedules.filter(item => item.id !== rule.id);
        persistSchedules();
        renderSchedules();
      });

      actions.append(toggle, removeBtn);
      row.append(info, actions);
      scheduleListEl.append(row);
    });
  }

  const actionLabels = {
    morning: 'Таңғы ояну (перделерді ашу, шамды өшіру)',
    evening: 'Кешкі жайлылық (қонақ пен асхана шамын қосу)',
    night: 'Түнгі режим сценарийі',
    away: 'Үйден шығу сценарийі',
    movie: 'Кино сценарийі'
  };

  scheduleForm.addEventListener('submit', event => {
    event.preventDefault();
    const time = scheduleForm.elements.time.value;
    const action = scheduleForm.elements.action.value;
    if (!time || !actionLabels[action]) return;
    schedules.push({
      id: 'sched-' + Date.now(),
      time,
      action,
      label: actionLabels[action],
      enabled: true
    });
    schedules.sort((a, b) => a.time.localeCompare(b.time));
    persistSchedules();
    renderSchedules();
    scheduleStatus.textContent = 'Жаңа кесте қосылды: ' + time + ' — ' + actionLabels[action];
  });

  renderSchedules();
  restartClockTimer();

  return { updateSafetyReadouts, resetEmergency, setLiveSimulation };
}
