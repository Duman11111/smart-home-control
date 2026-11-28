import { icon, features } from './icons.js';
import {
  rooms, livingRoom, entryRoom, tvChannels, devices, getRoomDevices, roomHasDevice,
  roomStates, history, format, energyUse, scenes, appState, setRoomDevice, applyRules
} from './state.js';
import {
  getCloudConfig, saveCloudConfig, resetCloudConfig,
  logRoom, initLocalDatabase, syncToCloud, loadFromCloud
} from './storage.js';
import { roomPhotos, createRoomRenderer } from './room-renderer.js';
import { initPdfExport } from './pdf.js';
import { initChat } from './chat.js';
import { initSmartFeatures } from './simulator.js';

// Render feature cards & static icons
document.querySelector('#feature-list').innerHTML = features.map(([symbol, title, description]) =>
  '<article class="card reveal"><span class="tile-icon">' + icon(symbol) + '</span><h3>' + title + '</h3><p>' + description + '</p></article>'
).join('');
document.querySelectorAll('[data-icon]').forEach(element => {
  element.innerHTML = icon(element.dataset.icon);
});

const sensorForm = document.querySelector('#sensor-form');
const automaticToggle = document.querySelector('#iot-auto');
const historySelect = document.querySelector('#iot-series');
const storageStatus = document.querySelector('#iot-storage');

const tabs = document.querySelector('.tabs');
const panel = document.querySelector('#room-panel');
const deviceList = document.querySelector('.devices');
const sceneStatus = document.querySelector('.scene-status');
const sceneButtons = [...document.querySelectorAll('[data-scene]')];

const fxLight = document.querySelector('#fx-light');
const fxTv = document.querySelector('#fx-tv');
const fxCurtain = document.querySelector('#fx-curtain');
const roomToast = document.querySelector('#room-toast');
let toastTimer = 0;

function showRoomToast(message) {
  if (!roomToast || !message) return;
  roomToast.textContent = message;
  roomToast.hidden = false;
  roomToast.style.animation = 'none';
  void roomToast.offsetWidth;
  roomToast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { roomToast.hidden = true; }, 2200);
}

const setStorageText = text => { storageStatus.textContent = text; };

function logAndRefresh(index, action, quiet = false) {
  logRoom(index, action, r => energyUse(r, index), quiet ? undefined : setStorageText);
}

// Room tabs & floorplan
tabs.innerHTML = rooms.map((room, index) =>
  '<button type="button" role="tab" id="room-' + index + '" aria-controls="room-panel" data-room="' + index + '">' + room + '</button>'
).join('');

const floor = document.querySelector('.floor');
floor.innerHTML = rooms.map((room, index) =>
  '<button type="button" data-floor="' + index + '" style="--room-thumb:var(' + roomPhotos[index].asset + ')">' +
  icon(['home', 'moon', 'plug', 'door'][index]) + room + '</button>'
).join('');
floor.addEventListener('click', event => {
  const button = event.target.closest('[data-floor]');
  if (button) selectRoom(Number(button.dataset.floor));
});

const roomStage = document.querySelector('.room-stage');
const roomPhoto = roomStage.querySelector('.room-photo');
const sceneCanvas = document.querySelector('#room-render');

const { showRoomPhoto, updateRoomLighting } = createRoomRenderer(
  roomStage,
  roomPhoto,
  sceneCanvas,
  ({ curtainOpenPct, curtainMoving }) => {
    const room = roomStates[appState.selectedRoom];
    if (fxCurtain) {
      let label;
      if (curtainMoving) {
        label = `Қозғалуда (${curtainOpenPct}%)`;
      } else if (curtainOpenPct <= 2) {
        label = 'Жабық (0%)';
      } else if (curtainOpenPct >= 98) {
        label = 'Ашық (100%)';
      } else {
        label = `Ашық (${curtainOpenPct}%)`;
      }
      fxCurtain.querySelector('b').textContent = label;
      fxCurtain.classList.toggle('on', curtainOpenPct > 5);
    }
    const curtainCard = deviceList.querySelector('[data-kind="curtain"]');
    if (curtainCard) {
      curtainCard.style.setProperty('--curtain-open', (curtainOpenPct / 100).toFixed(3));
    }
  }
);

// Quick buttons on room image
const doorButton = document.querySelector('[data-quick="door"]');
const tvQuickButton = document.querySelector('[data-quick="tv"]');
const doorLabel = document.querySelector('#quick-door');
const doorLockNote = document.querySelector('#door-lock-note');
const quickButtons = [...document.querySelectorAll('[data-quick]')];

const toastMessages = {
  light: on => on ? '💡 Жарық қосылды' : '🌑 Жарық сөндірілді',
  tv: on => on ? '📺 Теледидар қосылды' : '📺 Теледидар өшірілді',
  curtain: on => on ? '🪟 Перде сырғып ашылуда…' : '🪟 Перде сырғып жабылуда…',
  ac: on => on ? '❄️ Кондиционер іске қосылды' : 'Кондиционер өшірілді',
  heater: on => on ? '🔥 Жылытқыш іске қосылды' : 'Жылытқыш өшірілді',
  lock: on => on ? '🔒 Есік құлыпталды' : '🔓 Есік құлпы ашылды',
  camera: on => on ? '📹 Камера жазуды бастады' : 'Камера өшірілді',
  socket: on => on ? '🔌 Розеткаға қуат берілді' : '🔌 Розетка өшірілді',
  door: on => on ? '🚪 Есік ашылуда…' : '🚪 Есік жабылуда…'
};

quickButtons.forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.quick;
  const idx = appState.selectedRoom;
  const room = roomStates[idx];
  if (!roomHasDevice(idx, key)) return;
  if (!setRoomDevice(room, key, !room[key], idx)) return;
  showRoomToast(toastMessages[key]?.(room[key]));
  manualChange(key === 'door' ? (room.door ? 'Есік ашылды' : 'Есік жабылды') : undefined);
  renderDevices(key);
}));

function renderPowerHistory(records) {
  const labels = document.querySelector('#power-times');
  const count = records.length;
  const marker = document.querySelector('#power-last');
  labels.replaceChildren();
  document.querySelector('#power-samples').textContent = count ? count + ' өлшем' : '';
  marker.setAttribute('visibility', count ? 'visible' : 'hidden');
  if (!count) {
    document.querySelector('#chart-line').setAttribute('d', '');
    document.querySelector('#chart-fill').setAttribute('d', '');
    document.querySelector('#power-range').textContent = 'Әзірге қуат өлшемі жоқ';
    return;
  }

  const times = records.map(record => Date.parse(record.at));
  const start = Math.min(...times);
  const end = Math.max(...times);
  const powers = records.map(record => record.power);
  const peak = Math.max(...powers);
  const coordinates = records.map((record, index) => {
    const x = end === start ? 130 : 4 + 252 * (times[index] - start) / (end - start);
    const y = 96 - 86 * record.power / Math.max(peak, 0.01);
    return [x, y];
  });
  const line = 'M' + coordinates.map(point => point.join(' ')).join('L');
  const last = coordinates[count - 1];
  document.querySelector('#chart-line').setAttribute('d', line);
  document.querySelector('#chart-fill').setAttribute('d', count > 1 ? line + 'L' + last[0] + ' 105L' + coordinates[0][0] + ' 105Z' : '');
  marker.setAttribute('cx', last[0]);
  marker.setAttribute('cy', last[1]);
  const includeDate = new Date(start).toDateString() !== new Date(end).toDateString();
  const clock = new Intl.DateTimeFormat('kk-KZ', {
    ...(includeDate ? { month:'2-digit', day:'2-digit' } : {}),
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
  for (const time of new Set([start, end])) {
    const label = document.createElement('time');
    label.dateTime = new Date(time).toISOString();
    label.textContent = clock.format(time);
    labels.append(label);
  }
  document.querySelector('#power-range').textContent = 'Ең жоғары қуат: ' + format.format(peak) + ' кВт';
}

function renderHistory() {
  const records = history[appState.selectedRoom].slice(-24);
  const key = historySelect.value;
  const values = records.map(row => row[key]);
  const min = Math.min(...values), max = Math.max(...values);
  const points = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * 500, max === min ? 65 : 110 - 90 * (v - min) / (max - min)].join(','));
  if (points.length === 1) points.push('500,65');
  document.querySelector('#iot-chart').setAttribute('points', points.join(' '));
  const unit = { air:'°C', humidity:'%', lux:'лк', power:'кВт' }[key];
  document.querySelector('#iot-scale').textContent = values.length
    ? 'Ең аз ' + format.format(min) + ' ' + unit + ' · Ең көп ' + format.format(max) + ' ' + unit
    : 'Әзірге жазба жоқ';
  const rows = [...records].reverse().map(record => {
    const tr = document.createElement('tr');
    for (const value of [new Date(record.at).toLocaleTimeString('kk-KZ'), record.air, record.humidity, record.lux, record.power, record.action]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    return tr;
  });
  document.querySelector('#iot-history').replaceChildren(...rows);
}

let smartHooks = null;

function updateMonitor() {
  const room = roomStates[appState.selectedRoom];
  for (const key of ['air', 'humidity', 'lux']) sensorForm.elements[key].value = room[key];
  automaticToggle.checked = room.auto;
  const warnings = [];
  if (room.smoke >= 50) warnings.push('Түтін қауіпті (' + room.smoke + ' ppm)');
  if (room.waterLeak) warnings.push('Су ағу анықталды');
  if (room.air >= 28) warnings.push('Температура жоғары');
  if (room.air <= 18) warnings.push('Температура төмен');
  if (room.humidity >= 70) warnings.push('Ылғалдылық жоғары');
  if (room.lux < 100) warnings.push('Жарық жеткіліксіз');
  document.querySelector('#iot-alert').textContent = warnings.length ? '⚠ ' + warnings.join(' · ') : 'Көрсеткіштер қалыпты';
  smartHooks?.updateSafetyReadouts();
  renderHistory();
}

function readouts() {
  const selectedRoom = appState.selectedRoom;
  const room = roomStates[selectedRoom];
  const hasTv = roomHasDevice(selectedRoom, 'tv');

  document.querySelector('#room-name').textContent = rooms[selectedRoom];
  roomStage.style.setProperty('--room-light', room.light ? .65 + room.brightness * .004 : .40);

  document.querySelector('#quick-light').textContent = room.light ? room.brightness + '%' : 'Өшірулі';
  if (tvQuickButton) {
    tvQuickButton.hidden = !hasTv;
    if (hasTv) {
      document.querySelector('#quick-tv').textContent = room.tv ? tvChannels[(room.tvChannel || 0) % tvChannels.length].split(' (')[0] : 'Өшірулі';
    }
  }
  document.querySelector('#quick-ac').textContent = room.ac ? room.temperature + ' °C' : 'Өшірулі';
  document.querySelector('#quick-lock').textContent = room.lock ? 'Құлыптаулы' : 'Құлпы ашық';

  if (fxLight) {
    fxLight.classList.toggle('on', Boolean(room.light));
    fxLight.querySelector('b').textContent = room.light ? room.brightness + '%' : 'Өшірулі';
  }
  if (fxTv) {
    fxTv.hidden = !hasTv;
    if (hasTv) {
      fxTv.classList.toggle('on', Boolean(room.tv));
      fxTv.querySelector('b').textContent = room.tv ? tvChannels[(room.tvChannel || 0) % tvChannels.length].split(' (')[0] : 'Өшірулі';
    }
  }

  doorButton.hidden = selectedRoom !== entryRoom;
  const blocked = selectedRoom === entryRoom && room.lock;
  doorButton.setAttribute('aria-disabled', String(blocked));
  doorLockNote.hidden = !blocked;
  doorButton.setAttribute('aria-describedby', blocked ? 'door-lock-note' : '');
  doorLabel.textContent = room.door ? 'Есікті жабу' : 'Есікті ашу';
  roomStage.dataset.curtainClosed = String(!room.curtain);
  updateRoomLighting(selectedRoom, room);
  document.querySelector('#quick-curtain').textContent = room.curtain ? 'Перде ашық' : 'Перде жабық';
  quickButtons.forEach(button => {
    if (button !== doorButton && !button.hidden) {
      button.setAttribute('aria-pressed', Boolean(room[button.dataset.quick]));
    }
  });
  const watts = energyUse(room, selectedRoom);
  document.querySelector('#temperature').textContent = room.air + ' °C';
  document.querySelector('#humidity').textContent = room.humidity + '%';
  document.querySelector('#energy').textContent = format.format(watts) + ' кВт';
  renderPowerHistory(history[selectedRoom].slice(-10));
  updateMonitor();
}

function buildDeviceVisualizer(key) {
  if (key === 'light') {
    return '<div class="dev-viz"><div class="viz-light-glow"></div><span class="viz-label"></span></div>' +
      '<label class="control" style="margin-top:7px"><span>Жарықтық</span><input data-slider="brightness" aria-label="Жарықтық" type="range" min="1" max="100"><output class="out-brightness"></output></label>';
  }
  if (key === 'tv') {
    return '<div class="dev-viz"><div class="viz-tv-screen"></div><span class="viz-label"></span></div>' +
      '<div class="tv-channel-bar"><button type="button" data-ch="-1" aria-label="Алдыңғы арна">◀</button><strong class="tv-ch-name"></strong><button type="button" data-ch="1" aria-label="Келесі арна">▶</button></div>';
  }
  if (key === 'curtain') {
    return '<div class="dev-viz"><div class="viz-curtain-window"></div><div class="viz-curtain-left"></div><div class="viz-curtain-right"></div><span class="viz-label"></span></div>' +
      '<label class="control" style="margin-top:7px"><span>Ашылуы</span><input data-slider="curtain" aria-label="Перде ашылу пайызы" type="range" min="0" max="100"><output class="out-curtain"></output></label>' +
      '<div class="curtain-presets"><button type="button" data-curtain-pct="0">Жабу 0%</button><button type="button" data-curtain-pct="50">50%</button><button type="button" data-curtain-pct="100">Ашу 100%</button></div>';
  }
  if (key === 'ac') {
    return '<div class="dev-viz"><div class="viz-waves"><i></i><i></i><i></i></div><span class="viz-label" style="margin-left:8px"></span></div>' +
      '<div class="control temp" style="margin-top:7px"><button type="button" data-temp="-1" aria-label="Температураны төмендету">−</button><strong></strong><button type="button" data-temp="1" aria-label="Температураны көтеру">+</button></div>';
  }
  if (key === 'heater') {
    return '<div class="dev-viz"><div class="viz-waves"><i></i><i></i><i></i></div><span class="viz-label" style="margin-left:8px"></span></div>';
  }
  if (key === 'camera') {
    return '<div class="dev-viz"><span class="rec-dot"></span><span class="viz-label"></span></div>';
  }
  return '<div class="dev-viz"><span class="viz-label"></span></div>';
}

function renderDevices(toggledKey) {
  const roomIndex = appState.selectedRoom;
  const room = roomStates[roomIndex];
  if (!deviceList.children.length) {
    deviceList.innerHTML = devices.map(([key, label]) =>
      '<article class="device" data-kind="' + key + '"><div class="device-head"><div><span class="device-symbol"></span><h3>' + label + '</h3></div><button type="button" class="toggle" role="switch" aria-label="' + label + '" data-device="' + key + '"></button></div><p class="state"></p>' + buildDeviceVisualizer(key) + '</article>'
    ).join('');
  }
  devices.forEach(([key, , symbol, on, off], index) => {
    const card = deviceList.children[index];
    const available = roomHasDevice(roomIndex, key);
    card.hidden = !available;
    if (!available) return;

    const active = Boolean(room[key]);
    const shownIcon = active ? symbol : key === 'lock' ? 'unlock' : 'off';
    const badge = card.querySelector('.device-symbol');
    if (badge.dataset.iconName !== shownIcon) {
      badge.innerHTML = icon(shownIcon);
      badge.dataset.iconName = shownIcon;
    }
    card.classList.toggle('active', active);
    if (toggledKey === key) {
      card.classList.remove('just-toggled');
      void card.offsetWidth;
      card.classList.add('just-toggled');
    }
    card.querySelector('.toggle').setAttribute('aria-checked', String(active));
    card.querySelector('.state').textContent = active ? on : off;

    const vizLabel = card.querySelector('.viz-label');
    if (vizLabel) {
      if (key === 'light') {
        card.style.setProperty('--lamp-alpha', (0.25 + 0.75 * room.brightness / 100).toFixed(2));
        vizLabel.textContent = active ? `${room.brightness}%` : 'Өшірулі';
      } else if (key === 'tv') {
        const chFull = tvChannels[(room.tvChannel || 0) % tvChannels.length];
        const chShort = chFull.split(' (')[0];
        vizLabel.textContent = active ? chShort : 'Standby';
        card.querySelector('.tv-ch-name').textContent = chShort;
      } else if (key === 'curtain') {
        const pct = typeof room.curtainLevel === 'number' ? room.curtainLevel : (active ? 100 : 0);
        vizLabel.textContent = pct === 0 ? 'Жабық' : pct === 100 ? 'Ашық' : `${pct}%`;
        card.style.setProperty('--curtain-open', (pct / 100).toFixed(3));
        card.querySelectorAll('[data-curtain-pct]').forEach(btn => {
          btn.classList.toggle('is-active', Number(btn.dataset.curtainPct) === pct);
        });
      } else if (key === 'ac') {
        vizLabel.textContent = active ? `${room.temperature} °C` : 'Өшірулі';
      } else if (key === 'heater') {
        vizLabel.textContent = active ? 'Жылыту' : 'Өшірулі';
      } else if (key === 'camera') {
        vizLabel.textContent = active ? 'REC · Жазба' : 'Өшірулі';
      } else if (key === 'lock') {
        vizLabel.textContent = active ? 'Құлыптаулы' : 'Ашық';
      } else if (key === 'socket') {
        vizLabel.textContent = active ? '220В · Қосулы' : 'Өшірулі';
      }
    }
  });
  const curPct = typeof room.curtainLevel === 'number'
    ? ((room.curtain && room.curtainLevel === 0) ? 100 : (!room.curtain && room.curtainLevel === 100) ? 0 : room.curtainLevel)
    : (room.curtain ? 100 : 0);
  room.curtainLevel = curPct;
  deviceList.querySelector('[data-slider="brightness"]').value = room.brightness;
  deviceList.querySelector('.out-brightness').value = room.brightness + '%';
  deviceList.querySelector('[data-slider="curtain"]').value = curPct;
  deviceList.querySelector('.out-curtain').value = curPct + '%';
  deviceList.querySelector('.temp strong').textContent = room.temperature + ' °C';
  deviceList.querySelector('[data-temp="-1"]').disabled = room.temperature <= 16;
  deviceList.querySelector('[data-temp="1"]').disabled = room.temperature >= 30;
  readouts();
}

function selectRoom(index, moveFocus = false) {
  appState.selectedRoom = index;
  document.querySelector('#chat-room').textContent = rooms[index];
  showRoomPhoto(index);
  [...tabs.children].forEach((button, i) => {
    button.setAttribute('aria-selected', i === index);
    button.tabIndex = i === index ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', 'room-' + index);
  [...floor.children].forEach((button, i) => button.setAttribute('aria-pressed', i === index));
  renderDevices();
  if (moveFocus) tabs.children[index].focus();
}

function manualChange(action = 'Құрылғы өзгерді') {
  appState.awayArmed = false;
  logAndRefresh(appState.selectedRoom, action);
  sceneButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
  sceneStatus.textContent = '';
}

// Sensor & automation events
sensorForm.addEventListener('submit', event => {
  event.preventDefault();
  const room = roomStates[appState.selectedRoom];
  for (const key of ['air', 'humidity', 'lux']) room[key] = Number(sensorForm.elements[key].value);
  applyRules(room);
  manualChange('Датчиктер жаңартылды');
  renderDevices();
});
automaticToggle.addEventListener('change', () => {
  const room = roomStates[appState.selectedRoom];
  room.auto = automaticToggle.checked;
  applyRules(room);
  manualChange(room.auto ? 'Автоматтандыру қосылды' : 'Автоматтандыру өшірілді');
  renderDevices();
});
historySelect.addEventListener('change', renderHistory);

// Tabs & device events
tabs.addEventListener('click', event => {
  const button = event.target.closest('[data-room]');
  if (button) selectRoom(Number(button.dataset.room));
});
tabs.addEventListener('keydown', event => {
  const cur = appState.selectedRoom;
  const indices = { ArrowLeft:(cur + rooms.length - 1) % rooms.length, ArrowRight:(cur + 1) % rooms.length, Home:0, End:rooms.length - 1 };
  if (!Object.hasOwn(indices, event.key)) return;
  event.preventDefault();
  selectRoom(indices[event.key], true);
});
deviceList.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const idx = appState.selectedRoom;
  const room = roomStates[idx];
  let toggledKey;
  if (button.dataset.device) {
    toggledKey = button.dataset.device;
    if (!setRoomDevice(room, toggledKey, !room[toggledKey], idx)) return;
    showRoomToast(toastMessages[toggledKey]?.(room[toggledKey]));
    manualChange(getRoomDevices(idx).find(([k]) => k === toggledKey)?.[1] + ' · ' + (room[toggledKey] ? 'Қосылды' : 'Өшірілді'));
  } else if (button.dataset.temp) {
    toggledKey = 'ac';
    room.temperature = Math.min(30, Math.max(16, room.temperature + Number(button.dataset.temp)));
    room.ac = true;
    showRoomToast(`❄️ Кондиционер: ${room.temperature} °C`);
    manualChange('Кондиционер температурасы · ' + room.temperature + ' °C');
  } else if (button.dataset.curtainPct !== undefined) {
    toggledKey = 'curtain';
    const pct = Number(button.dataset.curtainPct);
    room.curtainLevel = pct;
    room.curtain = pct > 5;
    showRoomToast(pct === 0 ? '🪟 Перде жабылуда…' : pct === 100 ? '🪟 Перде толық ашылуда…' : `🪟 Перде ${pct}% деңгейіне қойылды`);
    manualChange(`Перде · ${pct}%`);
  } else if (button.dataset.ch && idx === livingRoom) {
    toggledKey = 'tv';
    const curCh = room.tvChannel || 0;
    room.tvChannel = (curCh + Number(button.dataset.ch) + tvChannels.length) % tvChannels.length;
    room.tv = true;
    const chName = tvChannels[room.tvChannel];
    showRoomToast(`📺 Арна: ${chName}`);
    manualChange('Теледидар арнасы · ' + chName);
  } else {
    return;
  }
  renderDevices(toggledKey);
  const selector = button.dataset.device
    ? '[data-device="' + button.dataset.device + '"]'
    : button.dataset.temp
      ? '[data-temp="' + button.dataset.temp + '"]'
      : '[data-ch="' + button.dataset.ch + '"]';
  const nextButton = deviceList.querySelector(selector);
  if (nextButton) (nextButton.disabled ? deviceList.querySelector('.temp button:not([disabled])') : nextButton)?.focus();
});
deviceList.addEventListener('input', event => {
  if (event.target.type !== 'range') return;
  const room = roomStates[appState.selectedRoom];
  if (event.target.dataset.slider === 'curtain') {
    const pct = Number(event.target.value);
    room.curtainLevel = pct;
    room.curtain = pct > 5;
    event.target.nextElementSibling.value = pct + '%';
    renderDevices();
    return;
  }
  room.brightness = Number(event.target.value);
  if (!room.light) room.light = true;
  event.target.nextElementSibling.value = room.brightness + '%';
  renderDevices();
});
deviceList.addEventListener('change', event => {
  if (event.target.type !== 'range') return;
  const room = roomStates[appState.selectedRoom];
  if (event.target.dataset.slider === 'curtain') {
    showRoomToast(`🪟 Перде ашылуы: ${room.curtainLevel}%`);
    manualChange(`Перде ашылуы · ${room.curtainLevel}%`);
    readouts();
    return;
  }
  showRoomToast(`💡 Жарықтық: ${room.brightness}%`);
  manualChange('Шам жарықтығы өзгерді');
  readouts();
});

// Scenes
function triggerSceneByKey(key, customLogLabel) {
  const scene = scenes[key];
  if (!scene) return;
  appState.awayArmed = key === 'away';
  roomStates.forEach((room, index) => {
    scene.apply(room, index);
    if (index === entryRoom && room.lock) room.door = false;
    logAndRefresh(index, customLogLabel || scene.name);
  });
  const sceneRoom = { night:1, movie:0 };
  selectRoom(sceneRoom[key] ?? appState.selectedRoom);
  sceneButtons.forEach(item => item.setAttribute('aria-pressed', item.dataset.scene === key));
  showRoomToast('✨ Сценарий: ' + scene.name);
  sceneStatus.textContent = '«' + scene.name + '» сценарийі іске қосылды.' + (key === 'away' ? ' Күзет режимі белсенді.' : '');
}

sceneButtons.forEach(button => button.addEventListener('click', () => {
  triggerSceneByKey(button.dataset.scene);
}));

// Feature 6: Cloud Sync, Cloud Load, and Custom Supabase Project Config
const cloudButton = document.querySelector('#iot-cloud');
const cloudLoadButton = document.querySelector('#iot-cloud-load');
const cloudStatus = document.querySelector('#iot-cloud-status');
const cloudConfigForm = document.querySelector('#cloud-config-form');
const cloudResetBtn = document.querySelector('#cloud-config-reset');

function refreshCloudUi() {
  const cfg = getCloudConfig();
  const ready = Boolean(cfg.url && cfg.publishableKey);
  cloudButton.disabled = !ready;
  cloudLoadButton.disabled = !ready;
  if (cloudConfigForm) {
    cloudConfigForm.elements.url.value = cfg.url;
    cloudConfigForm.elements.key.value = cfg.publishableKey;
  }
  cloudStatus.textContent = ready ? 'Supabase · Сақтауға және жүктеуге дайын (' + new URL(cfg.url).host + ')' : 'Supabase жобасы бапталмаған';
}
refreshCloudUi();

cloudConfigForm?.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const url = cloudConfigForm.elements.url.value.trim();
    const key = cloudConfigForm.elements.key.value.trim();
    if (url) new URL(url);
    saveCloudConfig(url, key);
    refreshCloudUi();
  } catch {
    cloudStatus.textContent = 'Қате Project URL форматы (мысалы: https://xyz.supabase.co)';
  }
});

cloudResetBtn?.addEventListener('click', () => {
  resetCloudConfig();
  refreshCloudUi();
});

cloudButton.addEventListener('click', async () => {
  cloudButton.disabled = true;
  cloudLoadButton.disabled = true;
  cloudStatus.textContent = 'Бұлтқа сақталып жатыр…';
  try {
    const res = await syncToCloud();
    cloudStatus.textContent = 'Supabase · ' + res.count + ' бөлме бұлтта сақталды · ' + res.time;
  } catch (error) {
    const authDisabled = error?.code === 'anonymous_provider_disabled';
    cloudStatus.textContent = authDisabled
      ? 'Supabase жобасында анонимді кіру (Anonymous Sign-Ins) өшірулі тұр'
      : 'Бұлтқа сақтау расталмады · Жергілікті деректер сақталды';
  } finally {
    cloudButton.disabled = false;
    cloudLoadButton.disabled = false;
  }
});

cloudLoadButton.addEventListener('click', async () => {
  cloudButton.disabled = true;
  cloudLoadButton.disabled = true;
  cloudStatus.textContent = 'Бұлттан жүктеліп жатыр…';
  try {
    const res = await loadFromCloud(setStorageText);
    if (!res.count) {
      cloudStatus.textContent = 'Supabase · Бұл сеанс үшін сақталған жазба табылмады';
    } else {
      renderDevices();
      cloudStatus.textContent = 'Supabase · ' + res.count + ' бөлме бұлттан жүктелді · ' + res.time;
    }
  } catch (error) {
    const authDisabled = error?.code === 'anonymous_provider_disabled';
    cloudStatus.textContent = authDisabled
      ? 'Supabase жобасында анонимді кіру өшірулі тұр'
      : 'Бұлттан жүктеу сәтсіз аяқталды · Интернетті немесе кілтті тексеріңіз';
  } finally {
    cloudButton.disabled = false;
    cloudLoadButton.disabled = false;
  }
});

// Initialize Smart Features & Chat
let assistantNotify = null;
smartHooks = initSmartFeatures({
  logAndRefresh,
  renderDevices,
  selectRoom,
  triggerSceneByKey,
  notifyAssistant: msg => assistantNotify?.(msg)
});

const chatApi = initChat({
  selectRoom,
  manualChange,
  renderDevices,
  sceneButtons,
  resetEmergency: smartHooks.resetEmergency,
  setLiveSimulation: smartHooks.setLiveSimulation
});
assistantNotify = chatApi.notifyAssistant;

// Select initial room & connect IndexedDB + PDF
selectRoom(0);
const roomDataReady = initLocalDatabase(setStorageText, renderDevices);
initPdfExport(document.querySelector('#iot-pdf'), document.querySelector('#iot-pdf-status'), roomDataReady);

// Navigation, Views, Hero Film, Contact & Plans
const menu = document.querySelector('.menu');
const navigation = document.querySelector('#navigation');
function setMenu(open) {
  navigation.classList.toggle('open', open);
  menu.setAttribute('aria-expanded', open);
}
menu.addEventListener('click', () => setMenu(!navigation.classList.contains('open')));
navigation.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation.classList.contains('open')) {
    setMenu(false);
    menu.focus();
  }
});

const form = document.querySelector('#contact form');
const formStatus = document.querySelector('#form-status');
const contactKey = 'smart-home-control-contact';
const requestKey = 'smart-home-control-requests';
const requestList = document.querySelector('.request-list');
const planDetails = document.querySelector('#plan-details');
const planCopy = {
  Basic:'Жарық пен розетка секілді алғашқы құрылғыларды бір жерден басқаруға арналған.',
  Pro:'Бірнеше бөлмедегі құрылғыларды сценариймен басқарып, энергия шығынын бақылауға арналған.',
  Premium:'Бірнеше үйді бөлек профильдерде басқаруға және кеңейтілген автоматтандыру орнатуға арналған.'
};
function openPlan(name) {
  const card = document.querySelector('[data-tier="' + name + '"]');
  planDetails.dataset.tier = name;
  planDetails.querySelector('h2').textContent = name + ' · ' + card.querySelector('.price').textContent;
  planDetails.querySelector('#detail-description').textContent = planCopy[name];
  planDetails.querySelector('ul').replaceChildren(...card.querySelector('ul').cloneNode(true).children);
  planDetails.showModal();
}
document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => openPlan(button.dataset.detail)));
function loadRequests() {
  let records = JSON.parse(localStorage.getItem(requestKey));
  if (Array.isArray(records)) return records;
  const old = JSON.parse(localStorage.getItem(contactKey));
  return old && Object.hasOwn(planCopy, old.plan) ? [{ ...old, createdAt:null }] : [];
}
function renderRequests() {
  requestList.replaceChildren();
  let records = [];
  try { records = loadRequests(); } catch {}
  if (!records.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Әзірге өтінім жоқ.';
    requestList.append(empty);
  }
  records.forEach(record => {
    const card = document.createElement('article');
    card.className = 'card';
    const fields = [
      ['h3', record.plan], ['p', record.name], ['p', record.email],
      ['time', record.createdAt ? new Date(record.createdAt).toLocaleString('kk-KZ') : 'Бұрын сақталған өтінім'],
      ['p', record.message, 'request-message'], ['p', 'Браузерде сақталды', 'request-status']
    ];
    fields.forEach(([tag, value, className]) => {
      if (!value) return;
      const element = document.createElement(tag);
      element.textContent = value;
      if (className) element.className = className;
      card.append(element);
    });
    requestList.append(card);
  });
}
renderRequests();
function choosePlan(name) {
  form.elements.plan.value = name;
  formStatus.textContent = '';
  syncForm();
}
const submit = form.querySelector('button[type=submit]');
function syncForm() {
  const hasPlan = Object.hasOwn(planCopy, form.elements.plan.value);
  form.elements.message.required = !hasPlan;
  submit.querySelector('span').textContent = hasPlan ? 'Өтінімді жіберу' : 'Хабарламаны сақтау';
}
form.elements.plan.addEventListener('change', syncForm);
document.querySelector('#detail-apply').addEventListener('click', () => {
  choosePlan(planDetails.dataset.tier);
  planDetails.close();
});
try {
  const saved = JSON.parse(localStorage.getItem(contactKey));
  if (saved) ['name', 'email', 'plan', 'message'].forEach(field => {
    if (typeof saved[field] === 'string') form.elements[field].value = saved[field];
  });
} catch {}
document.querySelectorAll('[data-plan]').forEach(link => link.addEventListener('click', () => choosePlan(link.dataset.plan)));
syncForm();
form.addEventListener('input', () => { formStatus.textContent = ''; });
form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const entry = Object.fromEntries(new FormData(form));
    if (Object.hasOwn(planCopy, entry.plan)) {
      const records = loadRequests();
      records.unshift({ ...entry, createdAt:new Date().toISOString() });
      localStorage.setItem(requestKey, JSON.stringify(records));
      renderRequests();
      form.reset();
      syncForm();
      const link = document.createElement('a');
      link.href = '#requests';
      link.textContent = 'Өтінімді көру';
      link.style.textDecoration = 'underline';
      formStatus.replaceChildren('Өтінім сақталды. ', link);
    } else {
      localStorage.setItem(contactKey, JSON.stringify(entry));
      formStatus.textContent = 'Хабарлама осы браузерде сақталды.';
    }
  } catch {
    formStatus.textContent = 'Браузер хабарламаны сақтай алмады.';
  }
});

// Hero background video
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const houseFilm = document.querySelector('.house-film');
const filmControl = document.querySelector('.house-film-control');
let filmPausedByUser = false;

function syncHouseFilm() {
  if (document.querySelector('#home').hidden || motionPreference.matches || filmPausedByUser) {
    houseFilm.pause();
    return;
  }
  if (!houseFilm.hasAttribute('src')) houseFilm.src = houseFilm.dataset.source;
  houseFilm.muted = true;
  houseFilm.play().catch(() => {});
}
houseFilm.addEventListener('playing', () => {
  houseFilm.classList.add('ready');
  filmControl.hidden = false;
  filmControl.querySelector('span').textContent = 'Бейнені тоқтату';
});
houseFilm.addEventListener('pause', () => {
  filmControl.querySelector('span').textContent = 'Бейнені жалғастыру';
});
filmControl.addEventListener('click', () => {
  filmPausedByUser = !houseFilm.paused;
  syncHouseFilm();
});
motionPreference.addEventListener('change', syncHouseFilm);

// SPA hash views
const views = [...document.querySelectorAll('main > section[id]')];
const colors = {
  demo:['#eac290','#3b2b1d'], how:['#ddc7a6','#32271e'],
  compatibility:['#bdd0aa','#293025'], pricing:['#edb689','#39291e'],
  reviews:['#eac6ad','#392b25'], contact:['#bdd0aa','#2b3024']
};

function showView(scroll = false) {
  const id = window.location.hash.slice(1) || 'home';
  const view = views.find(section => section.id === id) || views[0];
  views.forEach(section => {
    section.hidden = section !== view;
    section.classList.toggle('view-enter', section === view);
  });
  document.querySelectorAll('.viewbar a, .navlinks a').forEach(link => {
    if (link.hash === '#' + view.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const [accent, halo] = colors[view.id] || ['#f2bd7b', '#37281d'];
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--halo', halo);
  document.title = (view.querySelector('h2')?.textContent || 'Ақылды үй') + ' · Smart Home Control';
  syncHouseFilm();
  if (view.id === 'demo') updateRoomLighting(appState.selectedRoom, roomStates[appState.selectedRoom]);
  if (scroll) window.requestAnimationFrame(() => window.scrollTo({ top:0, behavior:'instant' }));
}
showView();
window.addEventListener('hashchange', () => showView(true));

if ('IntersectionObserver' in window && !motionPreference.matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.remove('pending');
    entry.target.querySelectorAll('[data-count]').forEach(counter => {
      const start = performance.now();
      function tick(now) {
        const progress = Math.min((now - start) / 650, 1);
        counter.textContent = Math.round(Number(counter.dataset.count) * progress);
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    observer.unobserve(entry.target);
  }), { threshold:.12 });
  document.querySelectorAll('.reveal').forEach(element => {
    if (element.getBoundingClientRect().top > innerHeight) element.classList.add('pending');
    observer.observe(element);
  });
}

// Tap wave feedback & decorative button traces
document.addEventListener('click', event => {
  const control = event.target.closest?.('button:enabled, a[href], summary');
  if (!control || control.classList.contains('toggle') || motionPreference.matches) return;
  const bounds = control.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;

  const fromPointer = event.detail > 0;
  const x = fromPointer ? Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)) : bounds.width / 2;
  const y = fromPointer ? Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) : bounds.height / 2;
  const radius = Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y));
  const wave = document.createElement('span');
  wave.className = 'tap-wave';
  wave.setAttribute('aria-hidden', 'true');
  wave.style.setProperty('--tap-x', x + 'px');
  wave.style.setProperty('--tap-y', y + 'px');
  wave.style.setProperty('--tap-size', Math.ceil(radius * 2) + 'px');
  control.querySelector(':scope > .tap-wave')?.remove();
  control.append(wave);
  wave.addEventListener('animationend', () => wave.remove(), { once:true });
  setTimeout(() => wave.remove(), 520);
}, true);

const tracedControls = document.querySelectorAll('button:not(.toggle):not(.chat-close), a.btn, a.hero-link, .viewbar a');
const traceObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) target.classList.toggle('trace-in-view', isIntersecting);
}) : null;
for (const control of tracedControls) {
  control.dataset.buttonTrace = '';
  traceObserver?.observe(control);
}

// Segmented Dashboard Sub-Tabs (Devices / Automation / Safety / Monitoring)
const dashTabs = [...document.querySelectorAll('[data-dash-tab]')];
const dashPanes = [...document.querySelectorAll('[data-dash-pane]')];
function selectDashTab(name) {
  dashTabs.forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.dashTab === name)));
  dashPanes.forEach(pane => { pane.hidden = pane.dataset.dashPane !== name; });
}
dashTabs.forEach(btn => btn.addEventListener('click', () => selectDashTab(btn.dataset.dashTab)));

// Light / Dark Theme Switcher
const THEME_KEY = 'smart-home-control-theme';
const themeBtn = document.querySelector('#theme-toggle');
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
  if (themeBtn) {
    themeBtn.textContent = isLight ? '🌙' : '☀️';
    themeBtn.title = isLight ? 'Қараңғы тақырып' : 'Жарық тақырып';
  }
}
try {
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
} catch {
  applyTheme('dark');
}
themeBtn?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
});
