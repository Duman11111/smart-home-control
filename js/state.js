export const rooms = ['Қонақ бөлме','Ұйықтайтын бөлме','Асхана','Кіреберіс бөлме'];
export const livingRoom = 0;
export const entryRoom = rooms.length - 1;

export const tvChannels = [
  'Табиғат 4K (Тірі бейне)',
  'Cinema HD (Фильм)',
  'Түнгі Алау (Камин 4K)',
  'Qazaq News 24'
];

export const devices = [
  ['light','Шам','bulb','Қосулы','Өшірулі'],
  ['tv','Теледидар','tv','Қосулы','Өшірулі'],
  ['curtain','Перде','curtain','Ашық','Жабық'],
  ['ac','Кондиционер','climate','Қосулы','Өшірулі'],
  ['heater','Жылытқыш','climate','Қосулы','Өшірулі'],
  ['lock','Есік құлпы','lock','Құлыптаулы','Құлпы ашық'],
  ['camera','Камера','camera','Қосулы','Өшірулі'],
  ['socket','Розетка','plug','Қосулы','Өшірулі']
];

export function roomHasDevice(roomIndex, key) {
  if (key === 'tv') return roomIndex === livingRoom;
  if (key === 'door') return roomIndex === entryRoom;
  return true;
}

export function getRoomDevices(roomIndex) {
  return devices.filter(([key]) => roomHasDevice(roomIndex, key));
}

export const roomStates = rooms.map((_, index) => ({
  light: index !== 1,
  ...(index === livingRoom ? { tv: true, tvChannel: 0 } : {}),
  ac: index < 2,
  lock: index === entryRoom,
  ...(index === entryRoom ? { door: false } : {}),
  curtain: index !== 3,
  curtainLevel: index !== 3 ? 100 : 0,
  camera: index === 3,
  socket: index !== 3,
  brightness: index === 0 ? 78 : 60,
  temperature: [23, 21, 24, 20][index],
  humidity: [46, 50, 53, 42][index],
  air: [23, 21, 24, 20][index],
  lux: [250, 145, 390, 110][index],
  heater: false,
  auto: false,
  smoke: [8, 5, 14, 6][index],
  waterLeak: false,
  motion: false
}));

export const history = rooms.map(() => []);
export const changedDuringLoad = new Set();

export const format = new Intl.NumberFormat('kk-KZ', { maximumFractionDigits: 2 });

export const energyUse = (room, roomIndex = 0) => Number((
  0.18 +
  (room.light ? room.brightness * 0.001 : 0) +
  (roomIndex === livingRoom && room.tv ? 0.14 : 0) +
  (room.ac ? 0.83 : 0) +
  (room.heater ? 1.1 : 0) +
  (room.camera ? 0.04 : 0) +
  (room.socket ? 0.22 : 0)
).toFixed(2));

export const scenes = {
  away: {
    name: 'Үйден шығу',
    apply: (room, index) => {
      Object.assign(room, {
        light: false, ac: false, heater: false, lock: true,
        curtain: false, curtainLevel: 0, camera: true, socket: false
      });
      if (index === livingRoom) room.tv = false;
    }
  },
  night: {
    name: 'Түнгі режим',
    apply: (room, index) => {
      Object.assign(room, {
        light: index === 1, brightness: 15, lock: true,
        curtain: false, curtainLevel: 0, camera: index === 3
      });
      if (index === livingRoom) room.tv = false;
    }
  },
  movie: {
    name: 'Кино',
    apply: (room, index) => {
      if (index === livingRoom) {
        Object.assign(room, { light: true, tv: true, tvChannel: 1, brightness: 22, curtain: false, curtainLevel: 0, socket: true });
      }
    }
  }
};

export const appState = {
  selectedRoom: 0,
  awayArmed: false,
  emergencyActive: false,
  emergencyReason: '',
  sirenMuted: false
};

// A locked door cannot open. Engaging the lock closes the demo door.
export function setRoomDevice(room, key, on, roomIndex = appState.selectedRoom) {
  if (!roomHasDevice(roomIndex, key)) return false;
  if (key === 'door' && on && room.lock) return false;
  room[key] = on;
  if (key === 'curtain') room.curtainLevel = on ? 100 : 0;
  if (key === 'lock' && on && Object.hasOwn(room, 'door')) room.door = false;
  return true;
}

export function applyRules(room) {
  if (!room.auto) return;
  room.ac = room.air >= 28;
  room.heater = room.air <= 18;
  room.light = room.lux < 100;
}
