import {DurableObject} from 'cloudflare:workers';
import list from '../docs/aniversarios.txt';

const birthdays = Object.fromEntries(list.trim().split(/\r?\n/).map(line => line.split('|')));
const minute = 60_000;

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    if (!['/alarm','/pair'].includes(pathname)) return new Response('Not found',{status:404});

    const headers = {
      'Access-Control-Allow-Origin':env.APP_ORIGIN,
      'Access-Control-Allow-Methods':'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':'Authorization, Content-Type',
      'Cache-Control':'no-store',
      'Vary':'Origin'
    };
    const reply = (data,status) => Response.json(data,{status,headers});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    const alarm = env.ALARMS.get(env.ALARMS.idFromName('owner'));
    if (pathname === '/pair' && request.method === 'POST' && env.APP_PASSWORD) {
      if (request.headers.get('Authorization') === 'Bearer ' + env.APP_PASSWORD)
        return reply(await alarm.newPairCode(),200);
      try {
        const {code} = await request.json();
        if (typeof code === 'string' && /^[a-f0-9]{32}$/.test(code) && await alarm.claimPairCode(code))
          return reply({password:env.APP_PASSWORD},200);
      } catch {}
      return reply({error:'Código inválido, usado ou vencido'},401);
    }
    if (!env.APP_PASSWORD || request.headers.get('Authorization') !== 'Bearer ' + env.APP_PASSWORD)
      return reply({error:'Senha do app inválida'},401);
    try {
      if (request.method === 'GET') return reply({alarm:await alarm.status()},200);
      if (request.method === 'DELETE') return reply({alarm:await alarm.cancel()},200);
      if (request.method === 'POST') {
        await alarm.send({label:'Teste imediato',name:'Enviado pelo Birthday Clock'});
        return reply({sent:true},200);
      }
      if (request.method !== 'PUT') return reply({error:'Método inválido'},405);
      if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER)
        return reply({error:'Configure as chaves do Pushover no Cloudflare'},503);

      const {at,code,zone,injectId,leadMinutes = 3,atTime = false} = await request.json();
      if (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 60 || typeof atTime !== 'boolean')
        return reply({error:'Configuração de aviso inválida'},400);
      if (injectId !== undefined && (typeof injectId !== 'string' || !/^[0-9]{1,12}$/.test(injectId)))
        return reply({error:'ID do Inject inválido'},400);
      const now = Date.now();
      if (!Number.isSafeInteger(at) || at % 60_000 || at <= now || at > now + 25 * 60 * 60_000 || !/^\d{4}$/.test(code) || !birthdays[code])
        return reply({error:'Horário inválido ou já iniciado'},400);

      const date = new Intl.DateTimeFormat('pt-BR',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
      const label = date.format(at);
      if (label.replace(':','') !== code) return reply({error:'O horário não corresponde à data'},400);

      const result = await alarm.schedule({at,code,label,name:birthdays[code],notifyAt:at-leadMinutes*minute,atTime});
      if (injectId) result.inject = await sendToInject(injectId,birthdays[code]);
      return reply(result,200);
    } catch {
      return reply({error:'Não foi possível concluir a operação. Confira o aviso marcado antes de tentar de novo'},502);
    }
  }
};

async function sendToInject(id, name) {
  try {
    const response = await fetch('https://11z.co/_w/' + id + '/selection', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({value:name}),
      redirect:'error',
      signal:AbortSignal.timeout(6_000)
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export class BirthdayAlarm extends DurableObject {
  async newPairCode() {
    const code = crypto.randomUUID().replaceAll('-','');
    const expires = Date.now() + 15 * 60_000;
    await this.ctx.storage.put('pair',{code,expires});
    return {code,expires};
  }

  async claimPairCode(code) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const pair = await this.ctx.storage.get('pair');
      if (!pair || pair.code !== code || pair.expires <= Date.now()) return false;
      await this.ctx.storage.delete('pair');
      return true;
    });
  }

  async status() {
    return (await this.ctx.storage.get('alarm')) ?? null;
  }

  async cancel() {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.delete('alarm');
      await this.ctx.storage.deleteAlarm();
    });
    return null;
  }

  async schedule(item) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const store = this.ctx.storage;
      if (item.notifyAt <= Date.now()) {
        await this.send(item);
        if (item.atTime) {
          const next = {...item,notifyAt:item.at};
          await store.put('alarm',next);
          await store.setAlarm(next.notifyAt);
          return {alarm:next,sent:true};
        }
        await store.delete('alarm');
        await store.deleteAlarm();
        return {alarm:null,sent:true};
      }
      await store.put('alarm',item);
      await store.setAlarm(item.notifyAt);
      return {alarm:item,sent:false};
    });
  }

  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const store = this.ctx.storage;
      const item = await this.status();
      if (!item) return;
      const now = Date.now();
      if (now < item.notifyAt) {
        await store.setAlarm(item.notifyAt);
        return;
      }

      const isAdvance = item.notifyAt < item.at;
      if (now < (isAdvance ? item.at : item.at + 3 * minute)) await this.send(item);
      if (isAdvance && item.atTime) {
        const next = {...item,notifyAt:item.at};
        await store.put('alarm',next);
        await store.setAlarm(Math.max(next.notifyAt,Date.now()));
      } else {
        await store.delete('alarm');
      }
    });
  }

  async send(item) {
    const message = item.label + ' · ' + item.name;
    const response = await fetch('https://api.pushover.net/1/messages.json',{
      method:'POST',
      body:new URLSearchParams({token:this.env.PUSHOVER_TOKEN,user:this.env.PUSHOVER_USER,title:'Birthday Clock',message}),
      signal:AbortSignal.timeout(8_000)
    });
    if (!response.ok || (await response.json()).status !== 1) throw Error('Pushover recusou o aviso');
  }
}
