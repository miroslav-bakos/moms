self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  // Remove older caches containing authenticated order and backup responses.
  for (const name of await caches.keys()) if (name.startsWith('jmoms-api-')) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('push', e => {
  // Ignore payload text: providers can never supply personal data or arbitrary links to the UI.
  e.waitUntil(self.registration.showNotification('MOMS', {body:'Orders synchronized / Objednávky synchronizované',icon:'/icon-192.png',tag:'moms-sync',data:{path:'/'}}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients => {
    const existing=clients.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing)return existing.focus();
    return self.clients.openWindow('/');
  }));
});

// Requests use the network directly. Authenticated data is never stored in CacheStorage.
