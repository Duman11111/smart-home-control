export const icons = {
  home:'<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-7h6v7"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  play:'<path d="m8 5 12 7-12 7z"/>',
  bulb:'<path d="M9 18h6m-5 3h4m-5-6a6 6 0 1 1 6 0"/><path class="bulb-rays" d="M12 2v1.5M4.9 4.9l1.1 1.1M2 12h1.5M20.5 12H22M18 6l1.1-1.1"/>',
  climate:'<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z"/><path d="M12 10v8"/>',
  tv:'<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/><path class="tv-play" d="m10 8.5 5 2.5-5 2.5z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  unlock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2m-3.5 9v3"/>',
  energy:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  voice:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3"/>',
  spark:'<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
  curtain:'<path d="M3 4h18M4 4v16h5l2-5L8 4m12 0v16h-5l-2-5 3-11"/>',
  camera:'<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  plug:'<path d="M9 3v5m6-5v5M7 8h10v4a5 5 0 0 1-5 5v4m-5-9V8"/>',
  door:'<path d="M4 21h16M6 21V4h10v17m-6-9h2"/>',
  moon:'<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10z"/>',
  off:'<path d="M12 3v9m5-6a8 8 0 1 1-10 0"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4m0 4h.01"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'
};

export const icon = name =>
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  (icons[name] || icons.spark) +
  '</svg>';

export const features = [
  ['bulb','Жарық пен перде анимациясы','Шамның жану/сөну жарығын және перденің сырғып ашылу-жабылуын тікелей көріңіз.'],
  ['tv','Смарт Теледидар (Ambilight)','Экранның қосылу/өшу эффектісін, арналарды және қабырғадағы Ambilight сәулесін басқарыңыз.'],
  ['climate','Климат-бақылау','Кондиционердің салқын ауа ағыны мен жылытқыштың жылу толқынын бақылаңыз.'],
  ['shield','Қауіпсіздік және апаттық дабыл','Түтін, су ағу және қозғалыс датчиктері арқылы қауіптің алдын алыңыз.'],
  ['activity','Тірі IoT симуляциясы','Нақты уақыттағы датчик тербелістерін автоматты түрде бақылаңыз.'],
  ['clock','Кесте және бұлттық қор','Сағаттық сценарийлерді баптап, деректерді IndexedDB мен Supabase-те сақтаңыз.']
];
