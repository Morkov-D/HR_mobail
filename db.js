/* Versioned IndexedDB storage for non-authoritative cached HR data. PINs are never saved. */
'use strict';
window.HRDB = (() => {
  let dbPromise;
  const open = () => dbPromise ||= new Promise((resolve,reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB не поддерживается'));
    const req=indexedDB.open('hr-time-mobile',2);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('kv'))req.result.createObjectStore('kv');};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  async function transact(mode,key,value){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('kv',mode),store=tx.objectStore('kv');
      const req=mode==='readonly'?store.get(key):value===undefined?store.delete(key):store.put(value,key);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      tx.onerror=()=>reject(tx.error);
    });
  }
  return {get:key=>transact('readonly',key),set:(key,v)=>transact('readwrite',key,v),del:key=>transact('readwrite',key)};
})();
