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
let birthdays, alarm, busy = false;
let dateMode = 'DDMM';
try {
  const cached = JSON.parse(localStorage.getItem(alarmCacheKey) || 'null');
  if (config.password && cached?.notifyAt > Date.now()) alarm = cached;
} catch {}

function saveAlarm(value) {
  alarm = value;
  if (value) localStorage.setItem(alarmCacheKey,JSON.stringify(value));
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
  const items = [];
  for (let offset = 0; offset <= 1440 && items.length < 6; offset++) {
    const item = opportunity(start + offset * minute);
    if (item) items.push(item);
  }
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

function card(item, now) {
  const node = element('article','');
  const delta = item.at - now;
  const forward = delta > 0;
  const isMarked = alarm?.at === item.at && alarm?.code === item.code;
  if (isMarked) node.classList.add('marked');
  const state = forward ? 'Em ' + Math.ceil(delta / minute) + ' min' : 'Agora';
  const row = element('div','','row');
  row.append(element('time',item.label),element('small',state));
  node.append(row,element('p',''));
  node.lastElementChild.append(element('strong',item.name));
  node.append(element('small',item.birthday));
  if (forward && !isMarked) {
    const actions = element('div','','actions');
    const label = delta <= (config.leadMinutes ?? 3) * minute ? 'Avisar agora' : alarm ? 'Trocar aviso' : 'Me avise';
    actions.append(button(label, () => schedule(item), true));
    node.append(actions);
  } else if (isMarked) node.append(element('p','✓ Aviso marcado','marked-label'));
  return node;
}

function render() {
  if (!birthdays) return;
  const now = Date.now();
  const [featured, ...others] = opportunities(now);
  if (!featured) return;
  const featuredCard = card(featured,now);
  const today = new Date(now);
  const todayCode = String(today.getDate()).padStart(2,'0') + String(today.getMonth() + 1).padStart(2,'0');
  if (birthdays[todayCode]) {
    const todayBirthday = element('div','','today-birthday');
    const todayRow = element('div','','today-birthday-row');
    todayRow.append(
      element('strong',birthdays[todayCode],'today-birthday-name'),
      button('Enviar ao Inject',() => resendInject(birthdays[todayCode]))
    );
    todayRow.lastElementChild.classList.add('today-inject-button');
    todayBirthday.append(
      element('small','Aniversariante de hoje · ' + today.getDate() + ' de ' + months[today.getMonth()],'today-birthday-label'),
      todayRow
    );
    featuredCard.append(todayBirthday);
  }
  $('current').replaceChildren(featuredCard);
  $('upcoming').replaceChildren(...others.map(item => card(item,now)));
  $('alarm').hidden = !alarm;
  $('alarm').replaceChildren();
  if (alarm) {
    $('alarm').append(element('p','✓ Aviso marcado · ' + alarm.label + ' · ' + alarm.name,'marked-label'));
    const times = alarm.atTime && alarm.notifyAt < alarm.at
      ? clock.format(alarm.notifyAt) + ' e ' + clock.format(alarm.at)
      : clock.format(alarm.notifyAt);
    $('alarm').append(element('p','Notificação às ' + times));
    const actions = element('div','','actions');
    actions.append(button('Cancelar aviso',cancel));
    if (config.injectId) actions.append(button('Reenviar ao Inject',() => resendInject(alarm.name)));
    $('alarm').append(actions);
  }
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

async function update(action) {
  if (busy) return;
  busy = true;
  render();
  try { $('notice').textContent = await action(); }
  catch (error) { $('notice').textContent = error.message; }
  finally { busy = false; render(); }
}

function schedule(item) {
  if (!config.endpoint || !config.password) { $('settings').click(); return; }
  update(async () => {
    const result = await api('PUT',{at:item.at,code:item.code,mode:item.mode,zone:Intl.DateTimeFormat().resolvedOptions().timeZone,leadMinutes:config.leadMinutes ?? 3,atTime:config.atTime ?? false});
    const message = result.sent ? 'Aviso enviado ao Pushover' : 'Aviso marcado para ' + clock.format(result.alarm.notifyAt);
    if (!config.injectId) return message;
    try {
      await sendToInject(item.name);
      return message + ' · Nome enviado ao Inject';
    } catch {
      return message + ' · Falha no envio ao Inject';
    }
  });
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
}

function resendInject(name) {
  update(async () => {
    await sendToInject(name);
    return 'Nome enviado ao Inject';
  });
}

function cancel() {
  update(async () => { await api('DELETE'); return 'Aviso cancelado'; });
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
  try { await api(); render(); }
  catch (error) { $('notice').textContent = error.message; }
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
    localStorage.setItem(configKey,JSON.stringify(config));
    $('pair-code').value = '';
    renderConnection();
    $('notice').textContent = '';
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
  setInterval(() => { if (!document.hidden) render(); },1000);
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
