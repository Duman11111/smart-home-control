import { rooms, livingRoom, entryRoom, getRoomDevices, roomHasDevice, roomStates, scenes, appState, energyUse, format, setRoomDevice } from './state.js';

const chatRoomEndings = '(?:де|да|ге|ға|дегі|дағы|нің|ның|ні|ны)?';
const chatRoomPatterns = [
  new RegExp('қонақ бөлме(?:сі)?'+chatRoomEndings+'|қонақ бөлмесінде(?:гі)?|(?:в )?гостин(?:ая|ой|ую)','gu'),
  new RegExp('(?:ұйықтайтын|жатын) бөлме(?:сі)?'+chatRoomEndings+'|(?:ұйықтайтын|жатын) бөлмесінде(?:гі)?|(?:в )?спальн(?:я|е|ю|и)','gu'),
  /асхана(?:да|ға|дағы|ның|ны)?|ас үй(?:де|ге|дегі|дің|ді)?|(?:на |в )?кухн(?:я|е|ю|и)/gu,
  /ауыз үй(?:де|ге|дегі|дің|ді)?|кіреберіс(?: бөлме(?:сінде(?:гі)?|де(?:гі)?|ге|нің|ні)?|те|ке|тегі|тің|ті)?|(?:в )?прихож(?:ая|ей|ую)/gu
];

const chatDeviceNames = {
  light: /^(?:шам(?:ды)?|жарық(?:ты)?|жарығын|шамын|ламп(?:а|у|ы)|свет|освещение)$/u,
  tv: /^(?:теледидар(?:ды)?|телевизор(?:ды)?|тв|tv|экран(?:ды)?)$/u,
  ac: /^(?:кондиционер(?:ді)?|салқындатқыш(?:ты)?|кондиционерін)$/u,
  heater: /^(?:жылытқыш(?:ты)?|обогреватель|отопление)$/u,
  camera: /^(?:камера(?:ны|сын)?|камеру)$/u,
  socket: /^(?:розетка(?:ны|сын)?|розетку)$/u,
  curtain: /^(?:перде(?:ні|лерді|сін)?|штор(?:ы|у|а)|занавески)$/u,
  lock: /^(?:есік(?:ті)?|есік құлп(?:ы|ын)|құлып(?:ты)?|дверь|дверной замок|замок)$/u
};

const chatActions = [
  { pattern:/^(?:қос|қосшы|қосыңыз|жақ|жағыңыз|жақшы|включи|включите|включить)$/u, type:'power', value:true },
  { pattern:/^(?:өшір|өшірші|өшіріңіз|сөндір|сөндірші|сөндіріңіз|выключи|выключите|выключить|отключи)$/u, type:'power', value:false },
  { pattern:/^(?:аш|ашшы|ашыңыз|открой|откройте|открыть)$/u, type:'open', value:true },
  { pattern:/^(?:жап|жапшы|жабыңыз|закрой|закройте|закрыть)$/u, type:'open', value:false },
  { pattern:/^(?:құлыпта|құлыпташы|құлыптаңыз|запри|заблокируй)$/u, type:'lock', value:true },
  { pattern:/^(?:құлыптан шығар|отопри|разблокируй)$/u, type:'lock', value:false }
];

export function parseChat(text, currentRoom) {
  const fallbackRoom = Number.isInteger(currentRoom) && currentRoom >= 0 && currentRoom < 4 ? currentRoom : 0;
  const unknown = { kind:'unknown', room:fallbackRoom };
  if (typeof text !== 'string' || text.length > 240) return unknown;
  let command = text.normalize('NFKC').toLowerCase().replace(/ё/g,'е').trim().replace(/\s+/gu,' ');
  const question = command.endsWith('?');
  command = command.replace(/[.!?]+$/u,'').trim();
  command = command.replace(/^(?:өтінемін|пожалуйста)[, ]+/u,'').replace(/[, ]+(?:өтінемін|пожалуйста)$/u,'');
  if (/^(?:көмек|көмектес|не істей аласың|қандай (?:командалар|пәрмендер) бар|командалар|пәрмендер|сәлем|сәлеметсіз бе|привет|здравствуйте|помощь|команды|что ты умеешь)$/u.test(command)) {
    return { kind:'help', room:fallbackRoom };
  }
  if (/^(?:дабылды өшір|дабыл тоқтат|қауіпсіздік қалпына келтір|сброс тревоги|выключи сирену)$/u.test(command)) {
    return { kind:'reset_alarm', room:fallbackRoom };
  }
  if (/^(?:тірі симуляция|симуляцияны қос|симуляция)$/u.test(command)) {
    return { kind:'sim_on', room:fallbackRoom };
  }
  if (/^(?:симуляцияны өшір|симуляция тоқтат)$/u.test(command)) {
    return { kind:'sim_off', room:fallbackRoom };
  }
  if (!question) {
    const sceneCommand = command.replace(/^(?:іске қос|включи|включить|запусти) /u,'')
      .replace(/ (?:(?:режимін|сценарийін) )?(?:іске қос|қос|қосшы|қосыңыз)$/u,'')
      .replace(/[«»"]/gu,'');
    const scenesByName = {
      movie:['кино','кино режимі','режим кино'],
      night:['түнгі режим','түнгі режимді','ночной режим'],
      away:['үйден шығу','ухожу из дома','уход из дома']
    };
    for (const [scene, names] of Object.entries(scenesByName)) {
      if (names.includes(sceneCommand)) return { kind:'scene', room:fallbackRoom, scene };
    }
  }

  const matches = [];
  for (const [index, pattern] of chatRoomPatterns.entries()) {
    const bounded = new RegExp('(^| )(' + pattern.source + ')(?= |$)', 'gu');
    command = command.replace(bounded, (_, space) => {
      matches.push(index);
      return space;
    });
  }
  if (matches.length > 1) return unknown;
  const room = matches[0] ?? fallbackRoom;
  command = command.trim().replace(/\s+/gu,' ');
  const statusPattern = /^(?:бөлме(?:нің)? (?:күйі|көрсеткіштері)|(?:үйдің |бөлменің )?жағдайы|күйі|көрсеткіштер(?:ді|і)?(?: көрсет)?|температура(?:сы)?(?: қандай| қанша| неше градус)?|ауа температурасы(?: қандай| қанша)?|қанша градус|ылғалдылық(?: қандай| қанша)?|жарық деңгейі(?: қандай| қанша)?|қуат(?: қандай| қанша)?|статус(?: комнаты)?|состояние(?: комнаты)?|показатели(?: комнаты)?|(?:покажи )?показания датчиков|(?:какая )?(?:температура|влажность|освещенность|мощность)|сколько градусов)$/u;
  if (statusPattern.test(command)) return { kind:'status', room };
  if (!command || question) return unknown;
  for (const action of chatActions) {
    for (const [device, names] of Object.entries(chatDeviceNames)) {
      const actionWord = action.pattern.source.slice(1, -1);
      const deviceWord = names.source.slice(1, -1);
      const pair = new RegExp('^(?:' + actionWord + ' ' + deviceWord + '|' + deviceWord + ' ' + actionWord + ')$', 'u');
      if (!pair.test(command)) continue;
      if (action.type === 'power' && device !== 'lock' && device !== 'curtain') return { kind:'switch', room, device, on:action.value };
      if (action.type === 'open' && device === 'curtain') return { kind:'switch', room, device, on:action.value };
      if (action.type === 'open' && device === 'lock' && room === entryRoom && !/құлп|құлып|замок/u.test(command)) {
        return { kind:'switch', room, device:'door', on:action.value };
      }
      if (action.type === 'open' && device === 'lock') return { kind:'switch', room, device, on:!action.value };
      if (action.type === 'lock' && device === 'lock') return { kind:'switch', room, device, on:action.value };
    }
  }
  return unknown;
}

export function initChat({ selectRoom, manualChange, renderDevices, sceneButtons, resetEmergency, setLiveSimulation }) {
  const chatPanel = document.querySelector('#chat-panel');
  const chatLauncher = document.querySelector('#chat-launch');
  const chatInput = document.querySelector('#chat-input');
  const chatLog = document.querySelector('#chat-log');

  function setChatOpen(open) {
    chatPanel.hidden = !open;
    chatLauncher.hidden = open;
    chatLauncher.setAttribute('aria-expanded', String(open));
    if (open) {
      document.querySelector('#chat-room').textContent = rooms[appState.selectedRoom];
      chatInput.focus({ preventScroll:true });
      chatLog.scrollTop = chatLog.scrollHeight;
    } else {
      chatLauncher.focus({ preventScroll:true });
    }
  }

  chatLauncher.addEventListener('click', () => setChatOpen(true));
  chatPanel.querySelector('.chat-close').addEventListener('click', () => setChatOpen(false));
  chatPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); setChatOpen(false); }
  });

  function chatMessage(message, user = false) {
    const bubble = document.createElement('p');
    bubble.className = user ? 'chat-message user' : 'chat-message';
    bubble.textContent = message;
    chatLog.append(bubble);
    while (chatLog.children.length > 60) chatLog.firstElementChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function chatReply(text) {
    const question = text.trim().toLowerCase().replace(/[?!.]+$/u, '');
    if (/^(?:тарифтер|тарифтер қандай|тариф бағалары|бағалар|тарифы|цены|қандай тарифтер бар)$/u.test(question)) {
      const lines = [...document.querySelectorAll('#pricing .plan')].map(card => card.dataset.tier + ' — ' + card.querySelector('.price').textContent.trim());
      return lines.join('\n') + '\nТолық сипаттама мен өтінім формасы «Бағалар» бөлімінде.';
    }
    if (/^(?:өтінімдер|өтінімдерім|өтінімдерім қайда|мои заявки|где мои заявки)$/u.test(question)) {
      return '«Өтінімдер» бөлімінде осы браузерде сақталған тариф өтінімдеріңізді көре аласыз.';
    }
    const command = parseChat(text, appState.selectedRoom);
    const room = roomStates[command.room];
    if (command.kind === 'reset_alarm') {
      resetEmergency();
      return 'Апаттық дабыл өшірілді, қауіпсіздік датчиктері қалыпты күйге келтірілді.';
    }
    if (command.kind === 'sim_on') {
      setLiveSimulation(true);
      return 'Тірі IoT симуляция режимі іске қосылды.';
    }
    if (command.kind === 'sim_off') {
      setLiveSimulation(false);
      return 'Тірі IoT симуляция режимі тоқтатылды.';
    }
    if (command.kind === 'status') {
      const readings = room.air + ' °C · ' + room.humidity + '% · ' + room.lux + ' лк · ' + format.format(energyUse(room, command.room)) + ' кВт';
      const roomDevs = getRoomDevices(command.room);
      const available = command.room === entryRoom ? [...roomDevs, ['door','Есік','door','Ашық','Жабық']] : roomDevs;
      const equipment = available.map(([key, label, , on, off]) => label + ' — ' + (room[key] ? on : off).toLowerCase()).join('\n');
      const safety = 'Түтін: ' + room.smoke + ' ppm · Су ағу: ' + (room.waterLeak ? 'бар' : 'жоқ');
      return rooms[command.room] + '\n' + readings + '\n' + safety + '\n' + equipment + '\nАвтоматты басқару ' + (room.auto ? 'қосулы.' : 'өшірулі.');
    }
    if (command.kind === 'switch') {
      const targetRoom = command.device === 'tv' ? livingRoom : command.room;
      if (!roomHasDevice(targetRoom, command.device)) {
        return rooms[targetRoom] + ' бөлмесінде бұл құрылғы жоқ.';
      }
      const targetState = roomStates[targetRoom];
      const [key, label, , on, off] = command.device === 'door'
        ? ['door','Есік','door','Ашық','Жабық']
        : getRoomDevices(targetRoom).find(([k]) => k === command.device);
      selectRoom(targetRoom);
      if (targetState[key] !== command.on) {
        if (!setRoomDevice(targetState, key, command.on, targetRoom)) return 'Есік құлыптаулы. Алдымен «Есік құлпы» түймесін өшіріңіз.';
        manualChange('Чат · ' + label + ' · ' + (targetState[key] ? on : off));
        renderDevices(key);
      }
      return rooms[targetRoom] + ' · ' + label + ' ' + (targetState[key] ? on : off).toLowerCase() + '.';
    }
    if (command.kind === 'scene') {
      sceneButtons.find(button => button.dataset.scene === command.scene)?.click();
      const effect = {
        away:'Барлық бөлменің шамдары мен розеткалары өшірілді, есіктер құлыпталды, күзет қосылды.',
        night:'Түнгі режим үйге қолданылды. Жатын бөлменің шамы 15%-ға қойылды.',
        movie:'Қонақ бөлменің шамы 25%-ға қойылды, перде жабылды.'
      };
      return '«' + scenes[command.scene].name + '» сценарийі орындалды. ' + effect[command.scene];
    }
    if (command.kind === 'help') {
      return '«Асхананың күйі» деп көрсеткіштерді сұраңыз. «Шамды қос», «Жатын бөлмедегі пердені жап» деп құрылғыны басқарыңыз. «Кино», «Түнгі режим», «Үйден шығу», «Тірі симуляция» немесе «Дабылды өшір» командаларын қолдана аласыз.';
    }
    return 'Сұрауды түсінбедім. Бір бөлме мен бір әрекетті атаңыз. Мысалы, «Асханадағы шамды қос».';
  }

  function sendChat(text) {
    const message = text.trim();
    if (!message) return;
    chatMessage(message, true);
    chatInput.value = '';
    chatMessage(chatReply(message));
    document.querySelector('#chat-room').textContent = rooms[appState.selectedRoom];
  }

  document.querySelector('#chat-form').addEventListener('submit', event => {
    event.preventDefault();
    sendChat(chatInput.value);
  });
  chatPanel.querySelectorAll('.chat-prompts button').forEach(button =>
    button.addEventListener('click', () => sendChat(button.textContent))
  );

  return { notifyAssistant: msg => chatMessage(msg, false) };
}
