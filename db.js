/* IndexedDB: device-only cache of connection and personal snapshot. */
'use strict';
window.HRDB=(()=>{
  let dbPromise;
  const open=()=>dbPromise||=new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return reject(new Error('IndexedDB не поддерживается'));
    const q=indexedDB.open('hr-time-mobile',2);
    q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('kv'))q.result.createObjectStore('kv')};
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  });
  async function run(mode,key,value){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('kv',mode),s=tx.objectStore('kv');
      const q=mode==='readonly'?s.get(key):value===undefined?s.delete(key):s.put(value,key);
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);tx.onerror=()=>reject(tx.error);
    });
  }
  return {get:k=>run('readonly',k),set:(k,v)=>run('readwrite',k,v),del:k=>run('readwrite',k)};
})();