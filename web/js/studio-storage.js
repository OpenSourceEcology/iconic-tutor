// CAD payloads exceed localStorage's small synchronous quota. IndexedDB stores
// each complete session atomically and supports the embedded mesh/BREP assets.
let connection;
function database() {
  return (connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("ose-composition-studio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("session");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function saveSession(value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("session", "readwrite");
    transaction.objectStore("session").put(value, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function loadSession() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("session")
      .objectStore("session")
      .get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
