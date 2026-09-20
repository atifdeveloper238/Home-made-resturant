// ============================================================
// Polls Supabase for new orders and fires a Chrome notification
// + LOUD RING with Gain 4.5x
// ============================================================

const SUPABASE_URL = "https://kahmpvgqzxarsegnrogr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_rlRMyly8iVoOlqn9MMRVow_jgjVaWtx";
const POLL_INTERVAL_SECONDS = 20;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play loud order notification sound'
  });
}

async function playLoudRing() {
  try {
    await ensureOffscreen();
    // offscreen.js ko message bhejo
    chrome.runtime.sendMessage({ action: 'playLoud' });
  } catch (e) {
    console.log("Offscreen error", e);
  }
}

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
    await chrome.storage.local.set({ lastSeenOrderId: newest });
    return;
  }

  const newOrders = orders.filter(o => o.id > lastSeenOrderId);

  if (newOrders.length) {
    // 1. Notification dikhao
    newOrders.reverse().forEach(o => {
      chrome.notifications.create('order-' + o.id, {
        type: 'basic',
        iconUrl: 'icon.png',
        title: `New order #${o.id}`,
        message: `${o.customer_name} — Rs. ${o.total}`,
        priority: 2,
        requireInteraction: true // band nahi hoga jab tak click na karo
      });
    });

    // 2. LOUD RING bajao
    await playLoudRing();

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
  chrome.tabs.create({ url: 'YOUR_ADMIN_PAGE_URL/admin.html' });
  // click par awaz band kar do
  chrome.runtime.sendMessage({ action: 'stopLoud' });
});
