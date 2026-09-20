// ============================================================
// Polls Supabase for new orders and fires a Chrome notification —
// this is what covers "notify admin even when the app is closed":
// it runs as the extension's own background service worker, so it
// keeps polling as long as Chrome itself is running, independent
// of whether the admin.html tab or PWA window is open.
//
// Filled in with your project's URL + anon public key (same ones
// already in js/supabase-config.js — this key is meant to be public
// in client-side code, it is NOT the service_role secret key).
// ============================================================

const SUPABASE_URL = "https://ddlehbvmwdhqmtzjdvdk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hPd-CJO0256e4EhS9GkBgA_xJMTrKh-";
const POLL_INTERVAL_SECONDS = 20;

async function checkForNewOrders() {
  const { lastSeenOrderId } = await chrome.storage.local.get('lastSeenOrderId');

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?select=id,customer_name,total&order=id.desc&limit=5`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) return;
  const orders = await res.json();
  if (!orders.length) return;

  const newest = orders[0].id;

  if (lastSeenOrderId === undefined) {
    // first run — just record current newest, don't spam old orders
    await chrome.storage.local.set({ lastSeenOrderId: newest });
    return;
  }

  const newOrders = orders.filter(o => o.id > lastSeenOrderId);
  newOrders.reverse().forEach(o => {
    chrome.notifications.create('order-' + o.id, {
      type: 'basic',
      iconUrl: 'icon.png',
      title: `New order #${o.id}`,
      message: `${o.customer_name} — Rs. ${o.total}`,
      priority: 2
    });
  });

  if (newOrders.length) {
    await chrome.storage.local.set({ lastSeenOrderId: newest });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('pollOrders', { periodInMinutes: POLL_INTERVAL_SECONDS / 60 });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'pollOrders') checkForNewOrders();
});

chrome.notifications.onClicked.addListener(() => {
  // TODO: replace with your actual deployed Vercel admin URL, e.g.
  // 'https://your-site.vercel.app/admin.html'
  chrome.tabs.create({ url: 'YOUR_ADMIN_PAGE_URL/admin.html' });
});
