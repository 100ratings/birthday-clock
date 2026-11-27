const $ = id => document.getElementById(id);
const VERSION = '1.0.50';
// Impede gestos de zoom no iOS sem interferir em toques e rolagem
for (const type of ['gesturestart','gesturechange']) {
  document.addEventListener(type,event => event.preventDefault(),{passive:false});
}
const minute = 60_000;
const opportunityCount = 12;
const clock = new Intl.DateTimeFormat('pt-BR', {hour:'2-digit', minute:'2-digit'});
const months = 'janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
const configKey = 'birthday-clock-config';
const config = {endpoint:'https://birthday-clock.omentalistademian.workers.dev', ...JSON.parse(localStorage.getItem(configKey) || '{}')};
const alarmCacheKey = 'birthday-clock-alarm';
const lastInjectKey = 'birthday-clock-last-inject';
const confirmedInjectKey = 'birthday-clock-confirmed-inject';
function readLastInjectName() {
  try {
    const saved = JSON.parse(localStorage.getItem(lastInjectKey) || 'null');
    return saved?.id === config.injectId && typeof saved.name === 'string' ? saved.name : null;
  } catch { return null; }
}
let lastInjectName = readLastInjectName();
function readConfirmedInject() {
  try {
    const saved = JSON.parse(localStorage.getItem(confirmedInjectKey) || 'null');
    return saved?.id === config.injectId && Number.isSafeInteger(saved.at) &&
      /^\d{4}$/.test(saved.code) && typeof saved.name === 'string' ? saved : null;
  } catch { return null; }
}
let confirmedInject = readConfirmedInject();
let injectingAt = null;
let alarmRevision = 0;
function clearConfirmedInject() {
  confirmedInject = null;
  localStorage.removeItem(confirmedInjectKey);
}
function isInjectConfirmed(item) {
  return Boolean(config.injectId && confirmedInject && item &&
    confirmedInject.id === config.injectId && confirmedInject.at === item.at &&
    confirmedInject.code === item.code && confirmedInject.name === item.name &&
    lastInjectName === item.name);
}
function recordConfirmedInject(item) {
  if (!item || !alarm || alarm.at !== item.at ||
      alarm.code !== item.code || alarm.name !== item.name) {
    clearConfirmedInject();
    return;
  }
  confirmedInject = {id:config.injectId,at:item.at,code:item.code,name:item.name};
  localStorage.setItem(confirmedInjectKey,JSON.stringify(confirmedInject));
}
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
  if (!value && confirmedInject) clearConfirmedInject();
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
  if (cached?.start === start && cached.items.length === opportunityCount) return cached.items;
  const items = [];
  for (let offset = 0; offset <= 1440 && items.length < opportunityCount; offset++) {
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

const opportunityViews = new WeakMap();
function updateOpportunitySlot(node,item,now) {
  // Reutiliza as referências de cada cartão, inclusive os criados no pré-carregamento
  let view = opportunityViews.get(node);
  if (!view) {
    const identity = node.querySelector('.name-with-inject');
    const action = node.querySelector('.opportunity-control button');
    view = {
      time:node.querySelector('time'),
      remaining:node.querySelector('.countdown'),
      identity,
      name:identity.querySelector('strong'),
      birthday:node.querySelector('.opportunity-date'),
      action,
      badge:identity.querySelector('.inject-indicator'),
      ariaLabel:action.getAttribute('aria-label'),
      item:null,
      isMarked:null,
      isConfirmed:null,
      injectId:null
    };
    opportunityViews.set(node,view);
  }

  const delta = item.at - now;
  const isMarked = Boolean(alarm?.at === item.at && alarm?.code === item.code);
  const isConfirmed = isMarked && isInjectConfirmed(item);
  if (view.time.textContent !== item.label) view.time.textContent = item.label;
  const timeLeft = 'Em ' + Math.ceil(delta / minute) + ' min';
  if (view.remaining.textContent !== timeLeft) view.remaining.textContent = timeLeft;
  if (view.name.textContent !== item.name) view.name.textContent = item.name;
  if (view.birthday.textContent !== item.birthday) view.birthday.textContent = item.birthday;

  // Nas oportunidades, apenas o botão dourado comunica a confirmação
  if (view.badge) {
    view.badge.remove();
    view.badge = null;
  }

  const label = isMarked
    ? isConfirmed ? '✓' : injectingAt === item.at ? 'Enviando...' : config.injectId ? 'Enviar Inject' : 'Ajustar Inject'
    : delta <= (config.leadMinutes ?? 3) * minute ? 'Avisar agora'
    : alarm ? 'Trocar aviso' : 'Me avise';
  if (view.action.textContent !== label) view.action.textContent = label;
  if (view.isConfirmed !== isConfirmed) view.action.classList.toggle('selected-action',isConfirmed);
  const ariaLabel = isConfirmed
    ? 'Aviso agendado e envio ao Inject confirmado para ' + item.label + ', ' + item.name
    : isMarked ? label + ' para ' + item.label + ', ' + item.name + ', aviso já marcado'
    : label + ' para ' + item.label + ', ' + item.name;
  if (view.ariaLabel !== ariaLabel) {
    view.action.setAttribute('aria-label',ariaLabel);
    view.ariaLabel = ariaLabel;
  }
  if (view.item !== item || view.isMarked !== isMarked ||
      view.isConfirmed !== isConfirmed || view.injectId !== config.injectId) {
    view.action.onclick = isMarked
      ? isConfirmed ? null : config.injectId ? () => resendInject(item.name,item) : () => $('settings').click()
      : () => schedule(item);
  }
  const disabled = Boolean(isConfirmed || busy);
  if (view.action.disabled !== disabled) view.action.disabled = disabled;
  view.item = item;
  view.isMarked = isMarked;
  view.isConfirmed = isConfirmed;
  view.injectId = config.injectId;
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
  if (name === lastInjectName && !badge) identity.append(element('span','✓ Inject','inject-indicator'));
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
      const notify = element('small','Notificações às ','alarm-times');
      notify.append(element('time',clock.format(alarm.notifyAt),'alarm-notify-early'));
      if (alarm.atTime && alarm.notifyAt < alarm.at) {
        notify.append(element('span',' e '),element('time',clock.format(alarm.at),'alarm-notify-later'));
      }
      info.append(notify);
      const controls = element('div','','alarm-controls');
      const cancelButton = button('Cancelar',cancel);
      cancelButton.title = 'Cancelar aviso';
      controls.append(cancelButton);
      if (config.injectId) {
        const resendButton = button('Reenviar',() => resendInject(alarm.name,alarm));
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

  // Os doze cartões permanecem nos mesmos elementos, sem recriar a lista a cada atualização
  while (list.children.length > items.length) list.lastElementChild.remove();
  while (list.children.length < items.length) list.append(card());
  items.forEach((item,index) => updateOpportunitySlot(list.children[index],item,now));

  renderToday(now);
  renderAlarm();
  document.querySelector('main').classList.remove('booting');
}

async function api(method = 'GET', payload) {
  if (!config.endpoint || !config.password) throw Error('Conecte o Cloudflare em Ajustes para usar os avisos');
  const requestRevision = alarmRevision;
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
  // Ignora consultas iniciadas antes da troca ou do cancelamento de um aviso
  if (method === 'GET' && (busy || requestRevision !== alarmRevision)) return result;
  saveAlarm(result.alarm);
  return result;
}

function showNotice(message) {
  $('notice').textContent = message || 'Pronto para continuar';
}

async function update(action,pendingMessage = 'Processando...') {
  if (busy) return;
  busy = true;
  alarmRevision++;
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
    // Um novo aviso exige nova confirmação do Inject, mesmo para a mesma celebridade
    clearConfirmedInject();
    render();
    const message = result.sent ? 'Aviso enviado ao Pushover' : 'Aviso marcado para ' + clock.format(result.alarm.notifyAt);
    if (!config.injectId) return message + ' · Configure o Inject para confirmar';
    injectingAt = item.at;
    render();
    showNotice(message + ' · Enviando ao Inject...');
    try {
      await sendToInject(item.name,item);
      return message + ' · Enviado ao Inject: ' + item.name;
    } catch {
      return message + ' · Falha no Inject, use Enviar Inject para tentar novamente';
    } finally {
      injectingAt = null;
    }
  },'Marcando aviso...');
}

async function sendToInject(name,item = null) {
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
  recordConfirmedInject(item);
  render();
}

function resendInject(name,item = null) {
  update(async () => {
    if (item) {
      injectingAt = item.at;
      render();
    }
    try {
      await sendToInject(name,item);
      return 'Enviado ao Inject: ' + name;
    } finally {
      injectingAt = null;
    }
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
};
$('config').addEventListener('close', () => {
  if ($('config').returnValue !== 'save') return;
  config.leadMinutes = Number($('lead-minutes').value);
  config.atTime = $('at-time').checked;
  config.injectId = $('inject-id').value.trim();
  lastInjectName = readLastInjectName();
  confirmedInject = readConfirmedInject();
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
    confirmedInject = readConfirmedInject();
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

let remoteVersion = null;
let updateReloading = false;
let checkingUpdates = null;
let registrationPromise = Promise.resolve(null);
const updateStatus = $('update-status');
const updateButton = $('update-app');

function compareVersions(a,b) {
  const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number);
  for (let i=0; i<Math.max(A.length,B.length); i++) {
    const x=A[i]||0, y=B[i]||0;
    if (x>y) return 1;
    if (x<y) return -1;
  }
  return 0;
}
function updateVersionUI(status) {
  $('version-text').textContent = 'v' + VERSION;
  const available = remoteVersion && compareVersions(remoteVersion,VERSION)>0;
  updateButton.disabled = Boolean(status === 'Verificando…' || updateReloading || !available);
  updateStatus.textContent = status || (available ? 'Nova versão disponível' : 'Atualizado');
}
// Aguarda o SW novo para impedir que o SW anterior devolva HTML desatualizado
async function prepareServiceWorker() {
  const registration = await registrationPromise;
  if (!registration) return;
  try {
    await registration.update();
    const installing = registration.installing;
    if (!installing || installing.state === 'activated' || installing.state === 'redundant') return;
    await Promise.race([
      new Promise(resolve => {
        const onState = () => {
          if (installing.state === 'activated' || installing.state === 'redundant') {
            installing.removeEventListener('statechange',onState);
            resolve();
          }
        };
        installing.addEventListener('statechange',onState);
        onState();
      }),
      new Promise(resolve => setTimeout(resolve,3000))
    ]);
  } catch {
    // Caso SW não esteja disponível, o documento ainda pode atualizar pela rede
  }
}
async function updateApp() {
  if (updateReloading || !remoteVersion || compareVersions(remoteVersion,VERSION)<=0) return;
  if (!navigator.onLine) {
    updateVersionUI('Sem conexão para atualizar');
    return;
  }
  updateReloading = true;
  updateVersionUI('Atualizando…');
  await prepareServiceWorker();
  const url = new URL('./',location.href);
  url.searchParams.set('v',remoteVersion);
  url.searchParams.set('t',String(Date.now()));
  location.replace(url.href);
}
function checkUpdates(autoApply=false) {
  if (checkingUpdates) return checkingUpdates;
  updateVersionUI('Verificando…');
  checkingUpdates = (async () => {
    try {
      const response = await fetch('./version.json?check='+Date.now(),{cache:'no-store'});
      if (!response.ok) throw Error('HTTP '+response.status);
      const data = await response.json();
      if (!data || typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)) {
        throw Error('Versão inválida');
      }
      remoteVersion = data.version;
      updateVersionUI();
      if (autoApply && compareVersions(remoteVersion,VERSION)>0) {
        const requested = new URL(location.href).searchParams.get('v');
        if (requested !== remoteVersion) await updateApp();
      }
    } catch {
      remoteVersion = null;
      updateVersionUI('Não foi possível verificar');
    }
  })().finally(() => { checkingUpdates = null; });
  return checkingUpdates;
}
$('check-updates').onclick = () => checkUpdates(false);
updateButton.onclick = () => updateApp();
const openedUrl = new URL(location.href);
if (openedUrl.searchParams.get('v') === VERSION) {
  openedUrl.searchParams.delete('v');
  openedUrl.searchParams.delete('t');
  history.replaceState(history.state,'',openedUrl);
}
if ('serviceWorker' in navigator) {
  registrationPromise = navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'})
    .catch(error => {
      console.warn('Service Worker indisponível',error);
      return null;
    });
}
// Uma checagem na abertura real, nenhuma checagem de versão durante a sessão
checkUpdates(true);
