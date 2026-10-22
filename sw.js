'use strict';
const CACHE='hr-mobile-v5-20261022';
const STATIC=['./','./index.html','./styles.css','./app.js','./config.js','./db.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',evt=>{evt.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',evt=>{evt.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',evt=>{
  const req=evt.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return; // never cache Google API
  if(req.mode==='navigate'){
    evt.respondWith(fetch(req).catch(()=>caches.match('./index.html')));return;
  }
  evt.respondWith(fetch(req).then(res=>{
    if(res.ok&&url.pathname.match(/\.(?:js|css|svg|png|webmanifest)$/)){
      const copy=res.clone();evt.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)));
    }
    return res;
  }).catch(()=>caches.match(req)));
});
