/* QR Табель — статический мобильный клиент. Персональные данные не публикуются в GitHub. */
'use strict';
(() => {
  const $ = (selector, ctx=document) => ctx.querySelector(selector);
  const root = $('#app');
  const config = window.QR_APP_CONFIG || {};
  let endpoint = '';
  let endpointOk = false;
  const ENDPOINT_PATTERN=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  const storage = {token:'qrt_mobile_token_v3', connection:'connection',snapshot:'dashboard'};
  const state = {
    token:localStorage.getItem(storage.token)||'', home:null, view:'home', busy:false,
    scanAction:'AUTO', camera:null, cameraActive:false, frameId:null, scanBusy:false,
    installPrompt:null, offline:!navigator.onLine, cached:false, pairing:false, schedule:[],requests:[],fingerprint:'',lastSync:0,payroll:{enabled:false}
  };
  // Personal snapshots are read asynchronously from IndexedDB after connection pairing.
  // Links with ?code= from older releases are never accepted as attendance scans.
  if(new URL(location.href).searchParams.has('code')){
    const clean=new URL(location.href);clean.searchParams.delete('code');
    history.replaceState({},'',clean.pathname+clean.search+clean.hash);
  }
  function h(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function shortDate(d){try{return new Date(d).toLocaleDateString('ru-RU',{timeZone:state.home?.timezone||'Europe/Moscow',day:'2-digit',month:'short'});}catch{return String(d||'');}}
  function fullTime(d){if(!d)return '—';const a=new Date(d);return Number.isNaN(a.getTime())?'—':a.toLocaleString('ru-RU',{timeZone:state.home?.timezone||'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function clock(d){return fullTime(d).split(' ').slice(-1)[0];}
  function hour(min){const n=Math.max(0,Math.round(Number(min)||0));return (n/60).toLocaleString('ru-RU',{maximumFractionDigits:1})+' ч';}
  function fmtDelta(n){return (n>=0?'+':'−')+hour(Math.abs(n));}
  function icon(name,size=22){
    const paths={
      home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
      qr:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v3m-4 4h4m-7 0v-3"/>',
      calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
      right:'<path d="M5 12h14m-6-6 6 6-6 6"/>',left:'<path d="M19 12H5m6-6-6 6 6 6"/>',
      refresh:'<path d="M3 11a9 9 0 0 1 15.4-6.4L21 7m0-4v4h-4M21 13a9 9 0 0 1-15.4 6.4L3 17m0 4v-4h4"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
      log:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 4 5 5-5 5m5-5H9"/>',
      camera:'<path d="M5 7h3l2-3h4l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3"/>',
      check:'<path d="m4 12 5 5L20 6"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>'
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.clock}</svg>`;
  }
  let toastTimer;
  function notify(text){const t=$('#toast');t.textContent=String(text||'');t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,5000);}
  function randomHex(bytes=16){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');}
  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  function pollOnce(ticket,timeout=12000){
    return new Promise((resolve,reject)=>{
      const cb='__qr_cb_'+randomHex(8);
      let timer,script;
      const clean=()=>{clearTimeout(timer);delete window[cb];if(script)script.remove();};
      window[cb]=(data)=>{clean();resolve(data);};
      script=document.createElement('script');script.async=true;
      script.src=endpoint+'?mobileResult=1&ticket='+ticket+'&callback='+cb+'&_='+Date.now();
      script.onerror=()=>{clean();reject(new Error('Нет ответа от Google Apps Script.'));};
      timer=setTimeout(()=>{clean();reject(new Error('Превышено время ожидания ответа.'));},timeout);
      document.head.appendChild(script);
    });
  }
  /** POST: credentials, including PIN and session token, are only in POST body.
   * GET JSONP only carries a one-time ticket; server consumes the result once.
   */
  async function rpc(method,...args){
    if(!endpointOk)throw new Error('Администратор ещё не указал адрес Apps Script в config.js.');
    if(!navigator.onLine)throw new Error('Нет интернета. Отметка по QR требует связи с сервером.');
    const ticket=randomHex(16),payload=JSON.stringify({method,args});
    const post=fetch(endpoint,{method:'POST',mode:'no-cors',credentials:'omit',redirect:'follow',
      body:new URLSearchParams({mobile:'1',ticket,payload})}).catch(()=>null);
    // Start looking for a result while the request runs. Google may return an opaque response.
    const deadline=Date.now()+45000;
    let attempt=0;
    while(Date.now()<deadline){
      if(attempt++>0)await wait(Math.min(900+attempt*200,1800));
      try {
        const reply=await pollOnce(ticket,15000);
        if(!reply||!reply.ready)continue;
        if(!reply.ok)throw new Error(reply.error||'Ошибка Google Apps Script.');
        return reply.data;
      } catch(err){
        if(err.message!=='Нет ответа от Google Apps Script.' && err.message!=='Превышено время ожидания ответа.')throw err;
      }
    }
    await post;
    throw new Error('Не удалось подтвердить ответ сервера. Проверьте интернет и обновите данные перед повторной отметкой.');
  }
  async function saveSnapshot(data,fingerprint){
    state.home=data.home;state.schedule=data.schedule||[];state.requests=data.requests||[];
    state.payroll=data.payroll||{enabled:false};state.fingerprint=fingerprint||'';state.cached=false;state.lastSync=Date.now();
    try{await HRDB.set(storage.snapshot,{url:endpoint,data,fingerprint,employeeId:state.home?.state?.employee?.id,storedAt:Date.now()});}catch{/* storage quota */}
  }
  async function restoreSnapshot(){
    try{const record=await HRDB.get(storage.snapshot);
      if(record&&record.url===endpoint&&record.data?.home?.state&&state.token){
        state.home=record.data.home;state.schedule=record.data.schedule||[];state.requests=record.data.requests||[];
        state.payroll=record.data.payroll||{};state.fingerprint=record.fingerprint||'';state.cached=true;state.offline=true;
      }
    }catch{/* Browser privacy settings may disable IDB. */}
  }
  async function dropSession(){state.token='';state.home=null;state.cached=false;state.fingerprint='';state.schedule=[];state.requests=[];localStorage.removeItem(storage.token);try{await HRDB.del(storage.snapshot);}catch{}}
  function busy(flag){state.busy=flag;document.querySelectorAll('[data-busy]').forEach(x=>{x.disabled=flag;});}
  function errorPanel(error){return `<div class="error">${h(error)}</div>`;}
  function configuredPanel(){return `<main class="login-page"><div class="login-mark">${icon('qr',34)}</div><div class="eyebrow">ШАГ 1 ИЗ 2 · ПОДКЛЮЧЕНИЕ</div><h1>Ваш рабочий день<br>в одном приложении</h1>
    <p class="lead">Отсканируйте установочный QR-код, который выдаст руководитель. Это нужно сделать только один раз.</p>
    <section class="card"><div class="card-title">Подключение организации</div><p class="sub">QR должен содержать адрес опубликованного Google Apps Script (<b>.../exec</b>). Рабочие QR для отметки здесь не принимаются.</p>
    <div class="camera-box" id="camera-box"><div class="camera-placeholder">${icon('camera',46)}<span>Камера выключена</span></div></div>
    <button class="button" id="start-camera">${icon('qr',19)} Сканировать QR подключения</button>
    <details class="setup-manual"><summary>Не работает камера? Ввести адрес вручную</summary><form id="pair-manual" class="manual-form"><label for="apiurl">Адрес Apps Script</label><input id="apiurl" type="url" required placeholder="https://script.google.com/macros/s/.../exec"><button class="button secondary" type="submit">Проверить подключение</button></form></details>
    </section><p class="login-help">Не сканируйте QR из неизвестных источников: он определяет, куда отправляются ваши данные для входа.</p></main>`;}
  async function confirmPair(raw){
    const candidate=String(raw||'').trim().replace(/[?#].*$/,'');
    if(!ENDPOINT_PATTERN.test(candidate))throw new Error('Это не установочный QR. Нужен адрес Apps Script, заканчивающийся /exec.');
    const previous=endpoint,wasOk=endpointOk;
    endpoint=candidate;endpointOk=true;busy(true);
    try{
      const reply=await rpc('hello');
      if(reply.product!=='QR Табель'||!reply.ready)throw new Error('Неверная серверная часть HR.');
      if(!window.confirm('Подключить HR-систему по адресу?\n'+candidate+'\n\nПодтверждайте только QR от своего руководителя.'))throw new Error('Подключение отменено.');
      await HRDB.set(storage.connection,candidate);
      await dropSession();state.pairing=false;stopCamera();loginPage();
      notify('Организация подключена. Войдите по ID и PIN.');
    }catch(err){endpoint=previous;endpointOk=wasOk;state.pairing=true;render();throw err;}
    finally{busy(false);}
  }
  function loginPage(message=''){
    root.innerHTML=`<main class="login-page"><div class="login-mark">${icon('qr',34)}</div><h1>Рабочий день<br>под контролем</h1><p class="lead">Сканируйте QR-код на рабочем месте и отслеживайте свой табель в телефоне.</p>
    ${message?errorPanel(message):''}

    <form id="login-form"><div class="field"><label for="eid">ID сотрудника</label><input id="eid" type="text" placeholder="Например, 1002" autocomplete="username" required maxlength="40"></div>
    <div class="field"><label for="pin">PIN-код</label><input id="pin" type="password" placeholder="Введите PIN" autocomplete="current-password" inputmode="numeric" required maxlength="40"></div>
    <button class="button" id="sign-in" data-busy type="submit">Войти ${icon('right',18)}</button></form><p class="login-help">Доступ выдаёт ваш руководитель.<br>PIN-код не хранится в приложении.</p></main>`;
    $('#login-form').onsubmit=async e=>{
      e.preventDefault();if(state.busy)return;busy(true);
      const btn=$('#sign-in'),old=btn.innerHTML;btn.innerHTML='<span class="spin"></span> Вход…';
      try{
        const result=await rpc('login',$('#eid').value.trim(),$('#pin').value);
        state.token=result.token;localStorage.setItem(storage.token,result.token);
        await loadHome(true);
      }catch(err){loginPage(err.message);}finally{busy(false);if(btn?.isConnected)btn.innerHTML=old;}
    };
  }
  async function loadHome(first=false){
    if(!state.token){loginPage();return;}
    try{
      const result=await rpc('dashboard',state.token,state.fingerprint||'');
      if(result.notModified){state.offline=false;state.cached=false;state.lastSync=Date.now();}
      else if(result.data){await saveSnapshot(result.data,result.fingerprint);state.offline=false;}
      else throw new Error('Пустой ответ синхронизации.');
      if(first)state.view='home';render();
    }catch(err){
      if(/повторный вход|сессия истекла|деактивирован|требуется повторный вход|сессия недействительна/i.test(err.message)){
        await dropSession();loginPage('Сессия завершилась. Войдите снова.');return;
      }
      if(state.home){state.cached=true;state.offline=true;render();notify('Не удалось обновить данные. Показана последняя сохранённая версия.');}
      else loginPage('Нет связи с сервером: '+err.message);
    }
  }
  function head(){
    const hme=state.home,emp=hme.state.employee,on=hme.state.onShift;
    return `<header class="page-top"><div class="topline"><div class="brand"><span class="brand-icon">${icon('qr',17)}</span> HR Портал</div><div class="avatar" aria-label="Профиль">${h(emp.name.split(/\s+/).map(x=>x[0]||'').slice(0,2).join('').toUpperCase())}</div></div>
    <div class="greeting">Здравствуйте!</div><div class="person">${h(emp.name)}</div>
    <div class="position">${h(emp.positionName||'Сотрудник')} · ${h(emp.departmentName||emp.departmentId)}</div>
    <div class="statusline"><span class="pill ${on?'':'off'}">${on?'Сейчас на работе':'Сейчас вне смены'}</span></div></header>`;
  }
  function nav(){return `<nav class="bottom-nav" aria-label="Разделы приложения">
    <button class="nav-btn ${state.view==='home'?'active':''}" data-page="home">${icon('home')}Главная</button>
    <button class="nav-btn ${state.view==='schedule'?'active':''}" data-page="schedule">${icon('calendar')}Смены</button>
    <button class="nav-btn scan-tab" data-page="scan"><span>${icon('qr')}</span>QR</button>
    <button class="nav-btn ${state.view==='requests'?'active':''}" data-page="requests">${icon('clock')}Заявки</button>
    <button class="nav-btn ${state.view==='profile'?'active':''}" data-page="profile">${icon('info')}Ещё</button>
    </nav>`;}
  function homePage(){
    const d=state.home,m=d.metrics,on=d.state.onShift,percent=m.plannedMinutes?Math.max(0,Math.min(100,Math.round(m.actualMinutes*100/m.plannedMinutes))):0;
    const last=d.state.last;
    return `<div class="section-head"><h2>Мой рабочий месяц</h2><span class="sub">${h(m.month)}</span></div>
    <section class="card"><div class="stats"><div class="stat"><div class="stat-label">Норма месяца</div><div class="stat-value">${h(hour(m.plannedMinutes))}</div></div>
    <div class="stat"><div class="stat-label">Отработано</div><div class="stat-value">${h(hour(m.actualMinutes))}</div></div>
    <div class="stat wide"><div><div class="stat-label">Разница с нормой</div><div style="font-weight:800;color:${m.differenceMinutes>=0?'#168463':'#465a76'}">${h(fmtDelta(m.differenceMinutes))}</div></div><div class="sub" style="max-width:44%;text-align:right">Полная норма месяца</div></div></div>
    <div class="bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div style="width:${percent}%"></div></div>
    <div class="barlabel"><span>Выполнение плана</span><b>${percent}%</b></div></section>
    ${state.schedule.length?`<section class="card next-shifts"><div class="card-title">Ближайшие смены</div>${state.schedule.filter(x=>x.working).slice(0,3).map(x=>`<div class="shift-row"><b>${h(new Date(x.date+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}))}</b><span>${h(x.start)}–${h(x.end)} · ${h(hour(x.minutes))}</span></div>`).join('')}<button class="inline-link" data-page="schedule">Весь график →</button></section>`:''}
    <section class="card"><div class="card-title">Моя смена</div><p class="sub" style="margin:5px 0 17px">${last?'Последняя отметка: '+h(fullTime(last.at)):'Нет отметок'}${d.metrics.open?' · Смена не закрыта':''}</p>
    <button class="button" data-page="scan" ${state.offline?'disabled':''}>${icon('qr',21)} Сканировать QR-код</button><div class="mutedline">Для отметки нужна сеть и действующий QR с экрана рабочего места. Без QR изменить время нельзя.</div></section>
    ${m.anomalies?.length?`<section class="card warning"><div class="card-title">${icon('info',16)} Требуется проверка</div><p class="sub">${h(m.anomalies.join('; '))}</p></section>`:''}
    <div class="section-head"><h2>Последние отметки</h2><button data-page="history">Все дни →</button></div><section class="card">${historyEvents((d.history||[]).slice(0,4))}</section>`;
  }
  function historyEvents(events){return events?.length?events.map(r=>`<div class="record"><div><div class="record-kind">${r.type==='IN'?'↗ Приход':'↙ Уход'}</div><div class="record-note">${h(shortDate(r.at))} · Точка ${h(r.stationId)}</div></div><div class="record-time">${h(clock(r.at))}</div></div>`).join(''):'<div class="empty">Пока нет отметок</div>';}
  function historyPage(){
    const m=state.home.metrics,d=state.home;
    return `<div class="section-head"><h2>Табель по дням</h2><span class="sub">${h(m.month)}</span></div>
    <section class="card"><div class="stats"><div class="stat"><div class="stat-label">Норма</div><div class="stat-value">${h(hour(m.plannedMinutes))}</div></div><div class="stat"><div class="stat-label">Факт</div><div class="stat-value">${h(hour(m.actualMinutes))}</div></div></div></section>
    <section class="card"><div class="dayrow head"><div>Дата</div><div>План</div><div>Факт</div></div>
    ${(m.days||[]).map(x=>`<div class="dayrow"><div><b>${h(x.date.slice(8,10))} ${h(new Date(x.date+'T12:00:00Z').toLocaleDateString('ru-RU',{month:'short'}))}</b>
    ${x.adjusted?'<small class="flag">Корректировка</small>':x.auto?'<small class="flag">Автоуход</small>':''}</div><div>${h(hour(x.plannedMinutes))}</div><div style="font-weight:${x.minutes?'750':'400'}">${x.minutes?h(hour(x.minutes)):'—'}</div></div>`).join('')}</section>
    <div class="section-head"><h2>История сканирований</h2></div><section class="card">${historyEvents(d.history||[])}</section>
    <button class="button secondary" id="refresh-history" data-busy>${icon('refresh',18)} Обновить табель</button>`;
  }
  function schedulePage(){
    const arr=state.schedule||[];
    return `<div class="section-head"><h2>График рабочих смен</h2><span class="sub">40 дней вперёд</span></div>
      <section class="card"><div class="calendar-summary"><b>${arr.filter(x=>x.working).length}</b><span>рабочих дней в ближайшие 40 дней</span></div>
      ${(arr||[]).map(x=>`<div class="shift-row ${x.working?'':'day-off'}"><div><b>${h(new Date(x.date+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}))}</b><small>${x.working?'Рабочая смена':'Выходной'}</small></div><div class="shift-times">${x.working?`${h(x.start)}–${h(x.end)}<small>${h(hour(x.minutes))}${x.overnight?' · ночная':''}</small>`:'—'}</div></div>`).join('')}</section><p class="sub page-note">Это план по назначенному графику. Фактическое время учитывается по отметкам и утверждённым корректировкам.</p>`;
  }
  const REQ_TYPES={MISSING_IN:'Не отметил приход',MISSING_OUT:'Не отметил уход',HOURS:'Неверные часы',OTHER:'Другое'};
  const REQ_STATES={PENDING:'На рассмотрении',APPROVED:'Одобрена',REJECTED:'Отклонена',PROCESSING:'В обработке'};
  function requestsPage(){
    return `<div class="section-head"><h2>Заявки на корректировку</h2></div>
      <section class="card"><div class="card-title">Новая заявка</div><p class="sub" style="margin:7px 0 18px">Если пропустили сканирование или часы посчитаны неверно, направьте заявку руководителю.</p>
      <form id="request-form"><div class="field"><label>Дата</label><input type="date" name="day" id="request-day" required></div>
      <div class="field"><label>Причина обращения</label><select name="kind" id="request-kind" class="scan-select">${Object.entries(REQ_TYPES).map(([v,label])=>`<option value="${v}">${h(label)}</option>`).join('')}</select></div>
      <div class="field"><label>Сколько часов фактически отработано</label><div class="hours-inputs"><input type="number" name="hours" min="0" max="24" value="8" required aria-label="Часы"><span>час</span><input type="number" name="minutes" min="0" max="59" value="0" required aria-label="Минуты"><span>мин</span></div></div>
      <div class="field"><label>Комментарий руководителю</label><textarea name="reason" required minlength="10" maxlength="500" placeholder="Например, пришёл в 09:00, но забыл отметиться при входе. Ушёл в 18:00."></textarea></div>
      <button class="button" type="submit" data-busy ${state.offline?'disabled':''}>Отправить на рассмотрение</button></form></section>
      <div class="section-head"><h2>Мои обращения</h2><span class="sub">${state.requests.length}</span></div>
      <section class="card">${state.requests.length?state.requests.map(r=>`<div class="request-item"><div class="request-title">${h(REQ_TYPES[r.kind]||r.kind)} <span class="req-status ${h(r.status)}">${h(REQ_STATES[r.status]||r.status)}</span></div><div class="sub">${h(r.day)} · ${h(hour(r.minutes))}</div><p>${h(r.reason)}</p>${r.reviewComment?`<div class="req-comment">Ответ: ${h(r.reviewComment)}</div>`:''}</div>`).join(''):'<div class="empty">Пока нет заявок</div>'}</section>`;
  }
  function profilePage(){
    const e=state.home.state.employee;
    return `<div class="section-head"><h2>Профиль и настройки</h2></div><section class="card"><div class="personline"><div class="big-avatar">${h(e.name.split(/\s+/).map(s=>s[0]).slice(0,2).join(''))}</div><div><b>${h(e.name)}</b><div class="sub">ID ${h(e.id)} · ${h(e.positionName||'Сотрудник')}</div><div class="sub">${h(e.departmentName||e.departmentId)}</div></div></div></section>
    <section class="card"><div class="card-title">Расчёт зарплаты</div><p class="sub">Раздел появится после подключения правил начисления зарплаты, удержаний и доступа к расчётным листкам.</p><div class="coming-soon">В разработке</div></section>
    <section class="card"><div class="card-title">Подключение</div><p class="sub">Сервер: ${h(endpoint.replace(/\/macros\/s\/.+/, '/macros/s/…/exec'))}</p><p class="sub">Последняя синхронизация: ${state.lastSync?new Date(state.lastSync).toLocaleTimeString('ru-RU'):'сохранённые данные'}</p>
    <button class="button subtle" id="change-server" type="button">Сменить организацию</button></section>`;
  }
  async function submitRequest(event){
    event.preventDefault();if(state.busy)return;
    if(!navigator.onLine){notify('Для отправки заявки нужен интернет.');return;}
    const f=new FormData(event.currentTarget),mins=Number(f.get('hours'))*60+Number(f.get('minutes'));
    if(!Number.isInteger(mins)||mins>1440||mins<0){notify('Укажите корректное количество часов.');return;}
    busy(true);
    try{
      const result=await rpc('createCorrectionRequest',state.token,{day:f.get('day'),kind:f.get('kind'),minutes:mins,reason:f.get('reason'),requestId:randomHex(16)});
      await loadHome();notify('Заявка '+result.id+' отправлена руководителю.');
    }catch(err){notify(err.message);}finally{busy(false);}
  }
  function scanPage(){return `<div class="section-head"><h2>Отметка на работе</h2></div><section class="card"><div class="card-title">Отсканируйте код</div><p class="sub" style="margin-top:7px;margin-bottom:15px">Наведите камеру на меняющийся QR у входа в отдел или склад.</p>
    <div class="field"><label for="scan-action">Что зафиксировать</label><select id="scan-action" class="scan-select"><option value="AUTO">Автоматически (приход / уход)</option><option value="IN">Приход</option><option value="OUT">Уход (в том числе если забыт приход)</option></select></div>
    <div class="camera-box" id="camera-box"><div class="camera-placeholder">${icon('camera',46)}<span>Камера выключена</span></div></div>
    <button class="button" id="start-camera" data-busy>Включить камеру</button>
    <p class="mutedline">QR — не ссылка. Отметка сохраняется только после распознавания кода внутри этого приложения и проверки на сервере. Для iPhone используется резервный распознаватель.</p></section>
    <section class="card"><div class="card-title">Как отметить смену?</div><p class="sub" style="margin:8px 0 0">1. Войдите под своим ID. 2. Нажмите «Включить камеру». 3. Наведите камеру на актуальный QR. Время и рабочее место автоматически запишет сервер.</p></section>`;}
  function footerTools(){return `<div class="section-head"><button class="text-button" id="refresh" data-busy>${icon('refresh',15)} Обновить</button><button class="text-button" id="logout">Выйти из аккаунта</button></div>`;}
  function render(){
    if(!endpointOk){root.innerHTML=configuredPanel();
      $('#start-camera').onclick=()=>{state.pairing=true;startCamera();};
      $('#pair-manual').onsubmit=async e=>{e.preventDefault();try{await confirmPair($('#apiurl').value);}catch(err){notify(err.message);}};
      return;}
    if(!state.token){loginPage();return;}
    if(!state.home){root.innerHTML='<main class="login-page"><div class="login-mark">'+icon('qr')+'</div><h1>Загрузка табеля…</h1><p class="sub">Проверка сессии сотрудника</p></main>';return;}
    const offline=(state.offline||!navigator.onLine);
    const page=state.view==='home'?homePage():state.view==='history'?historyPage():state.view==='schedule'?schedulePage():state.view==='requests'?requestsPage():state.view==='profile'?profilePage():scanPage();
    root.innerHTML=`<div class="shell">${head()}${offline?'<div class="offline-banner">Данные из локального кэша. Приход, уход и отправка заявок доступны только онлайн.</div>':''}
    ${page}${footerTools()}</div>${nav()}`;
    root.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{if(state.busy)return;const page=b.dataset.page;
      if(page==='scan'&&offline){notify('Нужен интернет для отметки.');return;}
      state.view=page;stopCamera();render();window.scrollTo({top:0,behavior:'instant'});
    }));
    if($('#scan-action')){$('#scan-action').value=state.scanAction;$('#scan-action').onchange=e=>{state.scanAction=e.target.value;};}
    $('#logout').onclick=logout;
    $('#refresh').onclick=()=>refreshClick();
    if($('#refresh-history'))$('#refresh-history').onclick=()=>refreshClick();
    if($('#start-camera'))$('#start-camera').onclick=startCamera;
    if($('#request-form')){$('#request-form').onsubmit=submitRequest;$('#request-day').value=state.home.today;$('#request-day').max=state.home.today;}
    if($('#change-server'))$('#change-server').onclick=async()=>{
      if(!confirm('Сменить организацию? Вы выйдете из аккаунта, а сохранённый табель будет очищен.'))return;
      stopCamera();await dropSession();await HRDB.del(storage.connection);endpoint='';endpointOk=false;state.view='home';render();
    };
    busy(state.busy);
  }
  async function refreshClick(){if(state.busy)return;busy(true);try{await loadHome();notify('Данные обновлены.');}finally{busy(false);}}
  function readQr(raw){
    const value=String(raw||'').trim();
    if(!/^QRT1\.[A-Za-z0-9_-]{1,32}\.\d{7,12}\.[A-Za-z0-9_-]{40,50}$/.test(value))
      throw new Error('Это не QR рабочего места. Сканируйте код в приложении, а не ссылку.');
    return value;
  }
  async function foundQr(raw){
    if(state.scanBusy)return;
    state.scanBusy=true;stopCamera();busy(true);
    const mode=state.scanAction;
    try{
      if(state.pairing){await confirmPair(raw);return;}
      const code=readQr(raw);
      // A single atomic server call both validates the QR and records server time/location.
      const saved=await rpc('recordScan',state.token,code,randomHex(16),mode);
      state.view='home';
      await loadHome();
      const kind=saved.action==='IN'?'Приход':'Уход';
      const place=saved.station?.name||'рабочем месте';
      notify(saved.duplicateRequest?'Отметка уже сохранена.':`${kind} записан: ${place}. Время сервера: ${fullTime(saved.recordedAt)}.`);
    } catch(err){
      state.view='scan';render();notify(err.message);
    } finally {state.scanBusy=false;busy(false);}
  }
  function stopCamera(){
    state.cameraActive=false;
    if(state.frameId){cancelAnimationFrame(state.frameId);state.frameId=null;}
    if(state.camera){state.camera.getTracks().forEach(t=>t.stop());state.camera=null;}
  }
  async function startCamera(){
    if(state.cameraActive)return;
    if(!navigator.mediaDevices?.getUserMedia){notify('Камера недоступна. Проверьте HTTPS и разрешения браузера.');return;}
    let detector=null;
    if(typeof BarcodeDetector!=='undefined'){
      try{detector=new BarcodeDetector({formats:['qr_code']});}catch{detector=null;}
    }
    // jsQR is a fallback for Safari/iOS browsers lacking BarcodeDetector.
    if(!detector&&typeof window.jsQR!=='function'){
      notify('QR-сканер не загрузился. Проверьте доступ к библиотеке jsQR и обновите страницу.');return;
    }
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      state.camera=stream;state.cameraActive=true;
      const box=$('#camera-box');
      if(!box){stopCamera();return;}
      box.innerHTML='<video autoplay playsinline muted id="camera-video"></video><span class="scan-frame"></span>';
      const video=$('#camera-video');video.srcObject=stream;await video.play();
      $('#start-camera').textContent='Остановить камеру';$('#start-camera').onclick=()=>{stopCamera();state.view='scan';render();};
      let last=0,reading=false;
      const step=async now=>{
        if(!state.cameraActive||state.scanBusy)return;
        state.frameId=requestAnimationFrame(step);
        if(reading||now-last<240||video.readyState<2)return;
        last=now;reading=true;
        try{
          if(detector){const codes=await detector.detect(video);if(codes?.length)await foundQr(codes[0].rawValue);}
          else if(ctx){
            const width=Math.min(640,video.videoWidth||640);
            const height=Math.max(1,Math.round(width*(video.videoHeight||480)/(video.videoWidth||640)));
            canvas.width=width;canvas.height=height;
            ctx.drawImage(video,0,0,width,height);
            const pixels=ctx.getImageData(0,0,width,height);
            const result=window.jsQR(pixels.data,width,height,{inversionAttempts:'dontInvert'});
            if(result?.data)await foundQr(result.data);
          }
        }catch{/* Incomplete/blurred frames are ignored; server checks the token. */}finally{reading=false;}
      };
      state.frameId=requestAnimationFrame(step);
    }catch(err){stopCamera();notify(err.name==='NotAllowedError'?'Разрешите доступ к камере в браузере.':'Не удалось включить камеру: '+err.message);}
  }
  async function logout(){
    if(state.busy)return;stopCamera();
    const token=state.token;
    // Clear sensitive state immediately, even when network is absent.
    await dropSession();loginPage();
    if(token&&navigator.onLine)rpc('logout',token).catch(()=>{});
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();else if(endpointOk&&state.token&&navigator.onLine&&Date.now()-state.lastSync>10*60*1000)loadHome();});
  window.addEventListener('offline',()=>{state.offline=true;stopCamera();if(state.token&&state.home)render();});
  window.addEventListener('online',()=>{state.offline=false;if(state.token&&endpointOk)loadHome().catch(()=>{});});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.installPrompt=event;});
  if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
  render();
  (async()=>{
    try{endpoint=String(await HRDB.get(storage.connection)||'').trim();endpointOk=ENDPOINT_PATTERN.test(endpoint);}catch{endpoint='';endpointOk=false;}
    if(endpointOk&&state.token){await restoreSnapshot();render();if(navigator.onLine)await loadHome(true);}
    else render();
  })();
})();
