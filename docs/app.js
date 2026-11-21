const $ = id => document.getElementById(id);
const minute = 60_000;
const windowMs = 3 * minute;
const clock = new Intl.DateTimeFormat('pt-BR', {hour:'2-digit', minute:'2-digit'});
const months = 'janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
const configKey = 'birthday-clock-config';
const config = JSON.parse(localStorage.getItem(configKey) || '{}');
let birthdays, featured, alarm, busy = false;
let dismissed = new Set();

function opportunity(at) {
  const date = new Date(at);
  const day = date.getHours(), month = date.getMinutes();
  const code = String(day).padStart(2,'0') + String(month).padStart(2,'0');
  return birthdays[code] && {at, code, name:birthdays[code], label:clock.format(date), birthday:day + ' de ' + months[month - 1]};
}

function opportunities(now) {
  const start = Math.floor(now / minute) * minute;
  const active = [], future = [];
  for (let offset = -2; offset <= 1442 && future.length < 7; offset++) {
    const item = opportunity(start + offset * minute);
    if (!item) continue;
    (item.at <= now ? active : future).push(item);
  }
  return [...active.reverse(), ...future];
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
  const state = forward ? 'Em ' + Math.ceil(delta / minute) + ' min' : now < item.at + windowMs ? 'Agora' : 'Encerrada';
  const row = element('div','','row');
  row.append(element('time',item.label),element('small',state));
  node.append(row,element('p',''));
  node.lastElementChild.append(element('strong',item.name));
  node.append(element('small',item.birthday));
  if (forward && alarm?.at !== item.at && !dismissed.has(item.at)) {
    const actions = element('div','','actions');
    const label = delta <= windowMs ? 'Avisar agora' : alarm ? 'Trocar aviso' : 'Me avise';
    actions.append(button(label, () => schedule(item), true),button('Agora não',() => {
      dismissed.add(item.at);
      render();
    }));
    node.append(actions);
  } else if (alarm?.at === item.at) node.append(element('p','Aviso marcado'));
  return node;
}

function render() {
  if (!birthdays || !featured) return;
  const now = Date.now();
  const others = opportunities(now).filter(item => item.at !== featured.at).slice(0,5);
  $('current').replaceChildren(card(featured,now));
  $('upcoming').replaceChildren(...others.map(item => card(item,now)));
  $('next').hidden = now < featured.at + windowMs;
  $('alarm').hidden = !alarm;
  $('alarm').replaceChildren();
  if (alarm) $('alarm').append(element('p','Aviso marcado · ' + alarm.label + ' · ' + alarm.name),button('Cancelar aviso',cancel));
}

async function api(method = 'GET', payload) {
  if (!config.endpoint || !config.password) throw Error('Conecte o Cloudflare em Ajustes para usar os avisos');
  const response = await fetch(config.endpoint + '/alarm', {
    method, headers:{Authorization:'Bearer ' + config.password,'Content-Type':'application/json'},
    body:payload ? JSON.stringify(payload) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Não foi possível acessar os avisos');
  alarm = result.alarm;
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
  if (alarm && !confirm('Trocar o aviso marcado para ' + alarm.label + '?')) return;
  update(async () => {
    const result = await api('PUT',{at:item.at,code:item.code,zone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    return result.sent ? 'Aviso enviado ao Pushover' : 'Aviso marcado para ' + clock.format(result.alarm.notifyAt);
  });
}

function cancel() {
  update(async () => { await api('DELETE'); return 'Aviso cancelado'; });
}

function reopen() {
  if (!birthdays) return;
  dismissed = new Set();
  [featured] = opportunities(Date.now());
  render();
  syncAlarm();
}

async function syncAlarm() {
  if (!config.endpoint || busy) return;
  try { await api(); render(); }
  catch (error) { $('notice').textContent = error.message; }
}

$('next').onclick = () => {
  [featured] = opportunities(Date.now());
  render();
};
$('settings').onclick = () => {
  $('endpoint').value = config.endpoint || '';
  $('password').value = config.password || '';
  $('config').showModal();
};
$('config').addEventListener('close', () => {
  if ($('config').returnValue !== 'save') return;
  try {
    const value = new URL($('endpoint').value.trim());
    if (value.protocol !== 'https:') throw Error();
    config.endpoint = value.origin;
    config.password = $('password').value.trim();
    localStorage.setItem(configKey,JSON.stringify(config));
    alarm = null;
    render();
    syncAlarm();
  } catch { $('notice').textContent = 'Informe o endereço HTTPS do Worker'; }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) reopen(); });
window.addEventListener('pageshow', event => { if (event.persisted) reopen(); });
try {
  const response = await fetch('./aniversarios.txt');
  if (!response.ok) throw Error();
  birthdays = Object.fromEntries((await response.text()).trim().split(/\r?\n/).map(line => line.split('|')));
  reopen();
  setInterval(() => { if (!document.hidden) render(); },1000);
  setInterval(() => { if (!document.hidden) syncAlarm(); },15000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
} catch { $('notice').textContent = 'Não foi possível carregar a lista de aniversários'; }
