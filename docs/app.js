const $ = id => document.getElementById(id);
// Impede gestos de zoom no iOS sem interferir em toques e rolagem
for (const type of ['gesturestart','gesturechange']) {
  document.addEventListener(type,event => event.preventDefault(),{passive:false});
}
const minute = 60_000;
const clock = new Intl.DateTimeFormat('pt-BR', {hour:'2-digit', minute:'2-digit'});
const months = 'janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
const configKey = 'birthday-clock-config';
const config = {endpoint:'https://birthday-clock.omentalistademian.workers.dev', ...JSON.parse(localStorage.getItem(configKey) || '{}')};
const alarmCacheKey = 'birthday-clock-alarm';
const lastInjectKey = 'birthday-clock-last-inject';
function readLastInjectName() {
  try {
    const saved = JSON.parse(localStorage.getItem(lastInjectKey) || 'null');
    return saved?.id === config.injectId && typeof saved.name === 'string' ? saved.name : null;
  } catch { return null; }
}
let lastInjectName = readLastInjectName();
let birthdays, alarm, busy = false;
let dateMode = 'DDMM';
const opportunityCache = new Map();
if (window.__birthdayPreload?.mode === 'DDMM') {
  opportunityCache.set('DDMM',window.__birthdayPreload);
}
let alarmSnapshot = localStorage.getItem(alarmCacheKey);
try {
  const cached = JSON.parse(alarmSnapshot || 'null');
  if (config.password && cached?.notifyAt > Date.now()) alarm = cached;
} catch {}

function saveAlarm(value) {
  const nextSnapshot = value ? JSON.stringify(value) : null;
  alarm = value;
  if (nextSnapshot === alarmSnapshot) return;
  alarmSnapshot = nextSnapshot;
  if (nextSnapshot) localStorage.setItem(alarmCacheKey,nextSnapshot);
  else localStorage.removeItem(alarmCacheKey);
}

function opportunity(at) {
  const date = new Date(at);
  const hour = date.getHours(), minuteOfHour = date.getMinutes();
  const day = dateMode === 'DDMM' ? hour : minuteOfHour;
  const month = dateMode === 'DDMM' ? minuteOfHour : hour;
  const code = String(day).padStart(2,'0') + String(month).padStart(2,'0');
  return birthdays[code] && {at, code, mode:dateMode, name:birthdays[code], label:clock.format(date), birthday:day + ' de ' + months[month - 1]};
}

function opportunities(now) {
  const start = Math.ceil((now + 2 * minute) / minute) * minute;
  const cached = opportunityCache.get(dateMode);
  if (cached?.start === start) return cached.items;
  const items = [];
  for (let offset = 0; offset <= 1440 && items.length < 6; offset++) {
    const item = opportunity(start + offset * minute);
    if (item) items.push(item);
  }
  opportunityCache.set(dateMode,{start,items});
  return items;
}

function element(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function button(label, action, primary = false) {
  const node = element('button', label, primary ? 'primary' : '');
  node.disabled = busy;
  node.onclick = action;
  return node;
}

function card() {
  const node = element('article','','opportunity');
  const timing = element('div','','opportunity-time');
  timing.append(element('time',''),element('small','','countdown'));
  const person = element('div','','opportunity-person');
  const identity = element('div','','name-with-inject');
  identity.append(element('strong',''));
  person.append(identity,element('small','','opportunity-date'));
  const control = element('div','','opportunity-control');
  const action = button('',() => {},true);
  control.append(action);
  node.append(timing,person,control);
  return node;
}

function updateOpportunitySlot(node,item,now) {
  const delta = item.at - now;
  const isMarked = alarm?.at === item.at && alarm?.code === item.code;
  const time = node.querySelector('time');
  const remaining = node.querySelector('.countdown');
  const identity = node.querySelector('.name-with-inject');
  const name = identity.querySelector('strong');
  const birthday = node.querySelector('.opportunity-date');
  const action = node.querySelector('.opportunity-control button');

  if (time.textContent !== item.label) time.textContent = item.label;
  const timeLeft = 'Em ' + Math.ceil(delta / minute) + ' min';
  if (remaining.textContent !== timeLeft) remaining.textContent = timeLeft;
  if (name.textContent !== item.name) name.textContent = item.name;
  if (birthday.textContent !== item.birthday) birthday.textContent = item.birthday;

  const badge = identity.querySelector('.inject-indicator');
  if (item.name === lastInjectName && !badge) identity.append(element('span','✓ No Inject','inject-indicator'));
  if (item.name !== lastInjectName && badge) badge.remove();

  const label = isMarked ? '✓'
    : delta <= (config.leadMinutes ?? 3) * minute ? 'Avisar agora'
    : alarm ? 'Trocar aviso' : 'Me avise';
  if (action.textContent !== label) action.textContent = label;
  action.classList.toggle('selected-action',Boolean(isMarked));
  action.setAttribute('aria-label',isMarked ? 'Aviso marcado para ' + item.label + ', ' + item.name : label + ' para ' + item.label + ', ' + item.name);
  action.onclick = isMarked ? null : () => schedule(item);
  action.disabled = Boolean(isMarked || busy);
}

function renderToday(now) {
  const today = new Date(now);
  const code = String(today.getDate()).padStart(2,'0') + String(today.getMonth() + 1).padStart(2,'0');
  const name = birthdays[code];
  const section = $('today');
  section.hidden = !name;
  section.classList.toggle('selected-today',Boolean(name && name === lastInjectName));
  if (!name) return;

  let label = section.querySelector('.today-birthday-label');
  let identity = section.querySelector('.today-identity');
  let action = section.querySelector('.today-inject-button');
  if (!label || !identity || !action) {
    const area = element('div','','today-birthday');
    const row = element('div','','today-birthday-row');
    identity = element('div','','today-identity');
    identity.append(element('strong',name,'today-birthday-name'));
    action = button('Enviar ao Inject',() => sendTodayToInject(name));
    action.classList.add('today-inject-button');
    row.append(identity,action);
    label = element('small','','today-birthday-label');
    area.append(label,row);
    section.replaceChildren(area);
  }
  const labelText = 'Aniversariante de hoje · ' + today.getDate() + ' de ' + months[today.getMonth()];
  if (label.textContent !== labelText) label.textContent = labelText;
  const strong = identity.querySelector('strong');
  if (strong.textContent !== name) strong.textContent = name;
  const badge = identity.querySelector('.inject-indicator');
  if (name === lastInjectName && !badge) identity.append(element('span','✓ No Inject','inject-indicator'));
  if (name !== lastInjectName && badge) badge.remove();
  action.onclick = () => sendTodayToInject(name);
  action.disabled = busy;
}

let alarmRenderKey;
function renderAlarm() {
  const box = $('alarm');
  const key = alarm
    ? [alarm.at,alarm.code,alarm.label,alarm.name,alarm.notifyAt,alarm.atTime,Boolean(config.injectId)].join('|')
    : 'none';
  if (key !== alarmRenderKey) {
    alarmRenderKey = key;
    box.replaceChildren();
    box.classList.toggle('has-alarm',Boolean(alarm));
    const info = element('div','','alarm-info');
    if (alarm) {
      const heading = element('div','','alarm-heading');
      heading.append(
        element('small','✓ Aviso marcado ·','marked-label'),
        element('time',alarm.label,'alarm-time')
      );
      info.append(heading,element('strong',alarm.name,'alarm-name'));
      const day = Number(alarm.code?.slice(0,2));
      const month = Number(alarm.code?.slice(2,4));
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        info.append(element('small',day + ' de ' + months[month - 1],'alarm-date'));
      }
      const times = alarm.atTime && alarm.notifyAt < alarm.at
        ? clock.format(alarm.notifyAt) + ' e ' + clock.format(alarm.at)
        : clock.format(alarm.notifyAt);
      info.append(element('small','Notificações às ' + times,'alarm-times'));
      const controls = element('div','','alarm-controls');
      const cancelButton = button('Cancelar',cancel);
      cancelButton.title = 'Cancelar aviso';
      controls.append(cancelButton);
      if (config.injectId) {
        const resendButton = button('Reenviar',() => resendInject(alarm.name));
        resendButton.title = 'Reenviar ao Inject';
        controls.append(resendButton);
      }
      box.append(info,controls);
    } else {
      info.append(element('strong','Nenhum aviso marcado','alarm-empty-title'));
      info.append(element('small','Escolha uma oportunidade abaixo','alarm-times'));
      box.append(info);
    }
  }
  for (const node of box.querySelectorAll('button')) node.disabled = busy;
}

function render() {
  if (!birthdays) return;
  const now = Date.now();
  const items = opportunities(now);
  const list = $('upcoming');

  // Os seis cartões permanecem nos mesmos elementos, sem recriar a lista a cada segundo
  while (list.children.length > items.length) list.lastElementChild.remove();
  while (list.children.length < items.length) list.append(card());
  items.forEach((item,index) => updateOpportunitySlot(list.children[index],item,now));

  renderToday(now);
  renderAlarm();
  document.querySelector('main').classList.remove('booting');
}

async function api(method = 'GET', payload) {
  if (!config.endpoint || !config.password) throw Error('Conecte o Cloudflare em Ajustes para usar os avisos');
  const response = await fetch(config.endpoint + '/alarm', {
    method, signal:AbortSignal.timeout(12_000), headers:{Authorization:'Bearer ' + config.password,'Content-Type':'application/json'},
    body:payload ? JSON.stringify(payload) : undefined
  });
  const result = await response.json();
  if (response.status === 401) {
    delete config.password;
    localStorage.setItem(configKey,JSON.stringify(config));
    saveAlarm(null);
    renderConnection();
    render();
    throw Error('Reconecte este aparelho em Ajustes');
  }
  if (!response.ok) throw Error(result.error || 'Não foi possível acessar os avisos');
  saveAlarm(result.alarm);
  return result;
}

function showNotice(message) {
  $('notice').textContent = message || 'Pronto para continuar';
}

async function update(action,pendingMessage = 'Processando...') {
  if (busy) return;
  busy = true;
  showNotice(pendingMessage);
  render();
  try { showNotice(await action()); }
  catch (error) { showNotice(error.message); }
  finally { busy = false; render(); }
}

function schedule(item) {
  if (!config.endpoint || !config.password) { $('settings').click(); return; }
  update(async () => {
    const result = await api('PUT',{at:item.at,code:item.code,mode:item.mode,zone:Intl.DateTimeFormat().resolvedOptions().timeZone,leadMinutes:config.leadMinutes ?? 3,atTime:config.atTime ?? false});
    // O check aparece assim que o servidor confirma, sem esperar pelo Inject
    render();
    const message = result.sent ? 'Aviso enviado ao Pushover' : 'Aviso marcado para ' + clock.format(result.alarm.notifyAt);
    if (!config.injectId) return message;
    showNotice(message + ' · Enviando ao Inject...');
    try {
      await sendToInject(item.name);
      return message + ' · Enviado ao Inject: ' + item.name;
    } catch {
      return message + ' · Falha no envio ao Inject';
    }
  },'Marcando aviso...');
}

async function sendToInject(name) {
  const id = config.injectId;
  if (!/^[0-9]{1,12}$/.test(id)) throw Error('Confira o ID do Inject em Ajustes');
  const response = await fetch('https://11z.co/_w/' + id + '/selection', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({value:name}),
    signal:AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw Error('Falha no envio ao Inject (' + response.status + ')');
  lastInjectName = name;
  localStorage.setItem(lastInjectKey,JSON.stringify({id,name}));
  render();
}

function resendInject(name) {
  update(async () => {
    await sendToInject(name);
    return 'Enviado ao Inject: ' + name;
  },'Enviando ao Inject...');
}

function sendTodayToInject(name) {
  update(async () => {
    // Não desmarcar o Pushover se o envio ao Inject não for confirmado
    await sendToInject(name);
    if (!alarm) return 'Enviado ao Inject: ' + name;
    showNotice('Enviado ao Inject: ' + name + ' · Cancelando aviso...');
    try {
      await api('DELETE');
      return 'Enviado ao Inject: ' + name + ' · Aviso cancelado';
    } catch (error) {
      return 'Enviado ao Inject: ' + name + ' · Atenção, não foi possível confirmar o cancelamento do aviso: ' + error.message;
    }
  },'Enviando ao Inject...');
}

function cancel() {
  update(async () => { await api('DELETE'); return 'Aviso cancelado'; },'Cancelando aviso...');
}

function reopen() {
  if (!birthdays) return;
  if (dateMode !== 'DDMM') {
    dateMode = 'DDMM';
    renderDateMode();
  }
  render();
  syncAlarm();
}

async function syncAlarm() {
  if (!config.endpoint || !config.password || busy) return;
  const before = alarmSnapshot;
  try {
    await api();
    if (alarmSnapshot !== before) render();
  } catch (error) { showNotice(error.message); }
}

function renderDateMode() {
  const control = $('date-mode');
  control.textContent = dateMode === 'DDMM' ? 'DD/MM' : 'MM/DD';
  control.setAttribute('aria-pressed',String(dateMode === 'MMDD'));
  control.setAttribute('aria-label',dateMode === 'DDMM' ? 'Modo dia e mês. Toque para inverter' : 'Modo mês e dia. Toque para voltar');
}

$('date-mode').onclick = () => {
  dateMode = dateMode === 'DDMM' ? 'MMDD' : 'DDMM';
  renderDateMode();
  render();
};
renderDateMode();

$('settings').onclick = () => {
  $('pair-code').value = '';
  renderConnection();
  $('lead-minutes').value = config.leadMinutes ?? 3;
  $('at-time').checked = config.atTime ?? false;
  $('inject-id').value = config.injectId || '';
  $('config').showModal();
  checkForUpdate();
};
$('config').addEventListener('close', () => {
  if ($('config').returnValue !== 'save') return;
  config.leadMinutes = Number($('lead-minutes').value);
  config.atTime = $('at-time').checked;
  config.injectId = $('inject-id').value.trim();
  lastInjectName = readLastInjectName();
  localStorage.setItem(configKey,JSON.stringify(config));
  if (!config.password) return;
  update(async () => {
    const result = await api('PATCH',{leadMinutes:config.leadMinutes,atTime:config.atTime});
    return result.alarm ? 'Horários do aviso atualizados' : 'Ajustes salvos';
  });
});

function renderConnection() {
  $('pair-fields').hidden = Boolean(config.password);
  $('connection-status').textContent = config.password ? 'Conectado' : 'Conecte este aparelho para marcar avisos';
}

$('pair-button').onclick = async () => {
  const code = $('pair-code').value.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code)) {
    $('connection-status').textContent = 'Cole o código de conexão completo';
    return;
  }
  $('pair-button').disabled = true;
  try {
    const response = await fetch(config.endpoint + '/pair', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code})
    });
    const result = await response.json();
    if (!response.ok || !result.password) throw Error(result.error || 'Não foi possível conectar');
    config.password = result.password;
    config.injectId = $('inject-id').value.trim();
    lastInjectName = readLastInjectName();
    localStorage.setItem(configKey,JSON.stringify(config));
    $('pair-code').value = '';
    renderConnection();
    showNotice('Conexão concluída');
    syncAlarm();
  } catch (error) {
    $('connection-status').textContent = error.message;
  } finally {
    $('pair-button').disabled = false;
  }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) reopen(); });
window.addEventListener('pageshow', event => { if (event.persisted) reopen(); });
try {
  birthdays = window.__birthdaySeed;
  if (!birthdays) {
    const response = await fetch('./aniversarios.txt');
    if (!response.ok) throw Error();
    birthdays = Object.fromEntries((await response.text()).trim().split(/\r?\n/).map(line => line.split('|')));
  }
  render();
  syncAlarm();
  // A lista mostra minutos, portanto não há motivo para recalculá-la a cada segundo
  function scheduleMinuteRefresh() {
    const delay = minute - (Date.now() % minute) + 75;
    setTimeout(() => {
      if (!document.hidden) render();
      scheduleMinuteRefresh();
    },delay);
  }
  scheduleMinuteRefresh();
  setInterval(() => { if (!document.hidden) syncAlarm(); },15000);

} catch {
  $('notice').textContent = 'Não foi possível carregar a lista de aniversários';
  document.querySelector('main').classList.remove('booting');
}

let registration;
let checkingUpdate;
const updateStatus = $('update-status');

function checkForUpdate() {
  if (!registration || !navigator.onLine) return Promise.resolve();
  if (checkingUpdate) return checkingUpdate;
  checkingUpdate = registration.update().catch(() => {}).finally(() => {
    checkingUpdate = null;
  });
  return checkingUpdate;
}

$('update-app').onclick = async () => {
  if (!navigator.onLine) {
    updateStatus.textContent = 'Conecte-se à internet para atualizar';
    return;
  }
  $('update-app').disabled = true;
  await checkForUpdate();
  const url = new URL(location.href);
  url.searchParams.set('_update', Date.now().toString());
  location.replace(url);
};

const openedUrl = new URL(location.href);
if (openedUrl.searchParams.has('_update')) {
  openedUrl.searchParams.delete('_update');
  history.replaceState(history.state, '', openedUrl);
}

if ('serviceWorker' in navigator) {
  const alreadyControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!alreadyControlled) return;
    $('update-app').textContent = 'Instalar atualização';
    updateStatus.textContent = 'Nova versão disponível';
  });
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(value => {
    registration = value;
    checkForUpdate();
  }).catch(console.warn);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate();
  });
  setInterval(() => { if (!document.hidden) checkForUpdate(); },30_000);
}
