// ============================================================
// CUSTOMER PAGE LOGIC
// UPDATED: size variants, order tracking tab, chat notifications,
// realtime chat bug fixed, image compression now targets 2-3KB.
// ============================================================

let MENU = [];
let SETTINGS = null;
let CUSTOMER = null;
const cart = {}; // key = item.id  OR  `${item.id}::${variant.id}` for variant items

// ---- IMAGE COMPRESS (targets 2-3KB output, as requested) ----
// NOTE: 2-3KB is a very small target for a real photo — expect
// roughly 100-150px wide and visibly soft. If payment screenshots
// need to stay legible (amount/TrxID readable), consider raising
// this in the two calls below (search "targetKB:").
async function compressImage(file, targetKB = 3, minTargetKB = 2) {
  const targetBytes = targetKB * 1024;
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = URL.createObjectURL(file);
  });

  let quality = 0.7;
  let maxWidth = 800;
  let blob = await drawAndCompress(img, maxWidth, quality);

  let attempts = 0;
  while (blob.size > targetBytes && attempts < 14) {
    attempts++;
    if (quality > 0.3) {
      quality -= 0.1;
    } else {
      maxWidth = Math.floor(maxWidth * 0.8);
      quality = 0.5;
    }
    blob = await drawAndCompress(img, maxWidth, quality);
  }

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

function drawAndCompress(img, maxWidth, quality) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    let width = img.width;
    let height = img.height;
    if (width > maxWidth) {
      height = (height * maxWidth) / width;
      width = maxWidth;
    }
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

// ---- NOTIFICATIONS ----
function initNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
    // Ask once, quietly, not blocking anything if the user ignores it.
    Notification.requestPermission();
  }
}

function notifyBrowser(title, body) {
  playBeep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/icon-192.png' }); } catch (e) { /* ignore */ }
  }
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) { /* ignore — audio may be blocked before user interacts with the page */ }
}

function showAuthTab(name) {
  document.querySelectorAll('[data-authtab]').forEach(b => b.classList.toggle('active', b.dataset.authtab === name));
  document.getElementById('authtab-login').classList.toggle('active', name === 'login');
  document.getElementById('authtab-signup').classList.toggle('active', name === 'signup');
}

// ---- CUSTOMER PAGE TABS (Menu / Track Order) ----
function showCustomerTab(name) {
  document.querySelectorAll('[data-customertab]').forEach(b => b.classList.toggle('active', b.dataset.customertab === name));
  document.getElementById('customertab-menu').classList.toggle('active', name === 'menu');
  document.getElementById('customertab-track').classList.toggle('active', name === 'track');
  if (name === 'track') {
    renderTrackTab();
  }
}

function renderTrackTab() {
  const wrap = document.getElementById('trackMyOrdersWrap');
  if (CUSTOMER) {
    wrap.classList.remove('hidden');
    loadMyOrders();
  } else {
    wrap.classList.add('hidden');
  }
}

async function trackOrderById() {
  const id = document.getElementById('trackOrderIdInput').value.trim();
  const resultEl = document.getElementById('trackResult');
  const notFoundEl = document.getElementById('trackNotFound');
  resultEl.classList.add('hidden');
  notFoundEl.classList.add('hidden');
  if (!id) return;

  const { data, error } = await supabaseClient.from('orders').select('*').eq('id', id).single();
  if (error || !data) {
    notFoundEl.classList.remove('hidden');
    return;
  }

  resultEl.innerHTML = `
    <h3>Order #${data.id}</h3>
    <span class="status ${data.status}">${STATUS_LABELS[data.status] || data.status}</span>
    <div class="panel-row" style="margin-top:14px"><span>Items</span></div>
    ${data.items.map(i => `<div class="panel-row"><span>${i.name} × ${i.qty}</span><span>Rs. ${i.price * i.qty}</span></div>`).join('')}
    <div class="panel-row total"><span>Total (incl. delivery)</span><span>Rs. ${data.total}</span></div>
    ${data.rider_name ? `<p class="muted" style="margin-top:12px">Rider: <strong>${data.rider_name}</strong> — ${data.rider_phone || ''}</p>` : ''}
  `;
  resultEl.classList.remove('hidden');
}

async function restoreSession() {
  const id = localStorage.getItem('customer_id');
  if (!id) return;
  const { data, error } = await supabaseClient.rpc('customer_get', { p_id: id });
  if (error || !data || data.length === 0) {
    localStorage.removeItem('customer_id');
    return;
  }
  setCustomer(data[0]);
}

function setCustomer(c) {
  CUSTOMER = c;
  localStorage.setItem('customer_id', c.id);
  document.getElementById('authPanel').classList.add('hidden');
  document.getElementById('accountPanel').classList.remove('hidden');
  document.getElementById('welcomeName').textContent = c.name;
  document.getElementById('custName').value = c.name;
  document.getElementById('custPhone').value = c.phone;
  document.getElementById('custLocation').value = c.location;
  loadChat();
  loadMyOrders();
  // FIX: this used to only happen once at page load (after restoreSession),
  // so a customer who logged in / signed up mid-session never opened the
  // realtime channel and never saw admin replies until a refresh. Now it
  // (re)subscribes every time we have a confirmed customer, covering
  // restored sessions, fresh logins, and fresh signups alike.
  subscribeChat();
}

const STATUS_LABELS = {
  pending: 'Order received', confirmed: 'Confirmed', preparing: 'Being prepared',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled'
};

async function loadMyOrders() {
  if (!CUSTOMER) return;
  const { data, error } = await supabaseClient
  .from('orders').select('*').eq('customer_id', CUSTOMER.id).order('id', { ascending: false });
  const targets = ['myOrdersList', 'myOrdersListTrack']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (targets.length === 0) return;

  const html = (error || !data || data.length === 0)
    ? '<p class="muted">No orders yet.</p>'
    : data.map(o => `
        <div class="panel-row" style="border-bottom:1px solid var(--line); padding:8px 0">
          <span>Order #${o.id} — ${new Date(o.created_at).toLocaleDateString()} — Rs. ${o.total}</span>
          <span class="status ${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
        </div>
      `).join('');

  targets.forEach(el => el.innerHTML = html);
}

async function customerSignup() {
  const name = document.getElementById('signupName').value.trim();
  const phone = document.getElementById('signupPhone').value.trim();
  const password = document.getElementById('signupPass').value;
  const location = document.getElementById('signupLocation').value.trim();
  const errEl = document.getElementById('signupErr');
  errEl.classList.add('hidden');
  if (!name || !phone || !password || !location) {
    errEl.textContent = 'Please fill in every field.';
    errEl.classList.remove('hidden');
    return;
  }
  const { data, error } = await supabaseClient.rpc('customer_signup', {
    p_phone: phone, p_password: password, p_name: name, p_location: location
  });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove('hidden');
    return;
  }
  setCustomer(data[0]);
}

async function customerLogin() {
  const phone = document.getElementById('loginPhone').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginErr');
  errEl.classList.add('hidden');
  const { data, error } = await supabaseClient.rpc('customer_login', { p_phone: phone, p_password: password });
  if (error || !data || data.length === 0) {
    errEl.textContent = 'Incorrect phone number or password.';
    errEl.classList.remove('hidden');
    return;
  }
  setCustomer(data[0]);
}

function customerLogout() {
  localStorage.removeItem('customer_id');
  CUSTOMER = null;
  document.getElementById('accountPanel').classList.add('hidden');
  document.getElementById('authPanel').classList.remove('hidden');
  supabaseClient.removeAllChannels();
}

async function updateAccount() {
  alert('To change your saved name or location, please contact us via chat — account editing is coming soon.');
}

async function loadSettings() {
  const { data, error } = await supabaseClient.from('settings').select('*').eq('id', 1).single();
  if (error || !data) return;
  SETTINGS = data;
  document.getElementById('kitchenName').textContent = data.kitchen_name || 'Home Kitchen';
  document.getElementById('kitchenPhone').textContent = data.kitchen_phone ? '📞 ' + data.kitchen_phone : '';
  document.getElementById('kitchenLocation').textContent = data.kitchen_location ? '📍 ' + data.kitchen_location : '';
  document.getElementById('kitchenDesc').textContent = data.kitchen_description || '';
  document.getElementById('epName').textContent = data.easypaisa_account_name || '';
  document.getElementById('epNumber').textContent = data.easypaisa_account_number || '';
  document.getElementById('deliveryChargeDisplay').textContent = 'Rs. ' + Number(data.delivery_charge || 0);
  if (!data.ordering_enabled) {
    document.getElementById('closedBanner').classList.remove('hidden');
  }
}

// ---- MENU (now with optional size variants) ----
async function loadMenu() {
  const { data, error } = await supabaseClient
  .from('menu_items').select('*').eq('available', true).order('created_at');
  const list = document.getElementById('menuList');
  if (error || !data || data.length === 0) {
    document.getElementById('noMenu').classList.remove('hidden');
    return;
  }
  document.getElementById('noMenu').classList.add('hidden');
  MENU = data;

  const variantItemIds = MENU.filter(m => m.has_variants).map(m => m.id);
  let variantsByItem = {};
  if (variantItemIds.length > 0) {
    const { data: variantRows } = await supabaseClient
      .from('menu_item_variants').select('*').in('menu_item_id', variantItemIds).order('sort_order');
    (variantRows || []).forEach(v => {
      if (!variantsByItem[v.menu_item_id]) variantsByItem[v.menu_item_id] = [];
      variantsByItem[v.menu_item_id].push(v);
    });
  }
  MENU.forEach(item => { item.variants = variantsByItem[item.id] || []; });

  list.innerHTML = MENU.map(item => {
    if (item.has_variants && item.variants.length > 0) {
      return `
        <div class="menu-item">
          ${item.photo_url ? `<img src="${item.photo_url}" alt="${item.name}">` : ''}
          <div class="info">
            <div class="name">${item.name}</div>
            <div class="desc">${item.description || ''}</div>
            <div class="variant-list">
              ${item.variants.map(v => {
                const key = `${item.id}::${v.id}`;
                return `
                  <div class="variant-row">
                    <div class="variant-row-info">
                      <span class="variant-name">${v.variant_name}</span>
                      <span class="variant-desc">${v.description || ''}</span>
                      <span class="variant-price">Rs. ${v.price}</span>
                    </div>
                    <div class="qty-controls">
                      <button class="qty-btn" onclick="changeQty('${key}', -1)">−</button>
                      <span id="qty-${key.replace('::','-')}">0</span>
                      <button class="qty-btn" onclick="changeQty('${key}', 1)">+</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="menu-item">
        ${item.photo_url ? `<img src="${item.photo_url}" alt="${item.name}">` : ''}
        <div class="info">
          <div class="name">${item.name}</div>
          <div class="desc">${item.description || ''}</div>
          <div class="price">Rs. ${item.price}</div>
          <div class="qty-controls">
            <button class="qty-btn" onclick="changeQty('${item.id}', -1)">−</button>
            <span id="qty-${item.id}">0</span>
            <button class="qty-btn" onclick="changeQty('${item.id}', 1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function changeQty(key, delta) {
  if (SETTINGS && !SETTINGS.ordering_enabled) return;
  cart[key] = Math.max(0, (cart[key] || 0) + delta);
  const spanId = 'qty-' + key.replace('::', '-');
  const span = document.getElementById(spanId);
  if (span) span.textContent = cart[key];
  renderCart();
}

// Resolves a cart key (plain item id, or "itemId::variantId") to a
// display name + unit price, whichever kind of item it is.
function resolveCartLine(key) {
  if (key.includes('::')) {
    const [itemId, variantId] = key.split('::');
    const item = MENU.find(m => m.id === itemId);
    const variant = item ? item.variants.find(v => v.id === variantId) : null;
    if (!item || !variant) return null;
    return { name: `${item.name} (${variant.variant_name})`, price: variant.price };
  }
  const item = MENU.find(m => m.id === key);
  if (!item) return null;
  return { name: item.name, price: item.price };
}

function renderCart() {
  const lines = Object.entries(cart).filter(([, qty]) => qty > 0);
  const cartPanel = document.getElementById('cartPanel');
  if (lines.length === 0) { cartPanel.classList.add('hidden'); return; }
  cartPanel.classList.remove('hidden');
  let subtotal = 0;
  const html = lines.map(([key, qty]) => {
    const line = resolveCartLine(key);
    if (!line) return '';
    const lineTotal = line.price * qty;
    subtotal += lineTotal;
    return `<div class="panel-row"><span>${line.name} × ${qty}</span><span>Rs. ${lineTotal}</span></div>`;
  }).join('');
  document.getElementById('cartLines').innerHTML = html;
  const deliveryCharge = Number(SETTINGS?.delivery_charge || 0);
  document.getElementById('cartTotal').textContent = 'Rs. ' + (subtotal + deliveryCharge);
}

function togglePaymentFields() {
  const method = document.getElementById('paymentMethod').value;
  document.getElementById('easypaisaBox').classList.toggle('hidden', method !== 'easypaisa');
  document.getElementById('onlineBox').classList.toggle('hidden', method !== 'online');
}
function toggleProof() {
  const selected = document.querySelector('input[name="paymentProof"]:checked');
  if (!selected) return;
  const val = selected.value;
  document.getElementById('photoBox').classList.toggle('hidden', val !== 'photo');
  document.getElementById('trxBox').classList.toggle('hidden', val !== 'trxid');
}
window.toggleProof = toggleProof;

async function placeOrder() {
  const errEl = document.getElementById('orderError');
  errEl.classList.add('hidden');
  const btn = document.querySelector('[onclick="placeOrder()"]') || document.getElementById('placeOrderBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }

  if (SETTINGS && !SETTINGS.ordering_enabled) {
    errEl.textContent = 'Sorry, we are currently closed and not accepting orders.';
    errEl.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
    return;
  }
  if (!CUSTOMER) {
    errEl.textContent = 'Please log in or create an account above before ordering.';
    errEl.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
    return;
  }
  const lines = Object.entries(cart).filter(([, qty]) => qty > 0);
  if (lines.length === 0) {
    errEl.textContent = 'Your cart is empty.';
    errEl.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
    return;
  }

  const method = document.getElementById('paymentMethod').value;
  let screenshotUrl = null;
  let paymentProofText = "";

  if (method === 'easypaisa') {
    const proofType = document.querySelector('input[name="paymentProof"]:checked')?.value || 'photo';
    if (proofType === 'trxid') {
      const trxId = document.getElementById('trxIdInput').value.trim();
      const senderNum = document.getElementById('senderNumberInput').value.trim();
      if (!trxId) {
        errEl.textContent = 'Please enter Transaction ID';
        errEl.classList.remove('hidden');
        if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
        return;
      }
      paymentProofText = `TRXID: ${trxId} | Sender: ${senderNum}`;
      screenshotUrl = null;
    } else {
      const fileInput = document.getElementById('screenshotInput');
      if (!fileInput.files[0]) {
        errEl.textContent = 'Please upload screenshot OR select TrxID option';
        errEl.classList.remove('hidden');
        if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
        return;
      }
      try {
        if (btn) btn.textContent = 'Compressing & Uploading...';
        const originalFile = fileInput.files[0];
        const compressedFile = await compressImage(originalFile, 3, 2);
        const filePath = `${Date.now()}_${originalFile.name}`;
        const { error: uploadErr } = await supabaseClient.storage
        .from('payment-screenshots').upload(filePath, compressedFile);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabaseClient.storage.from('payment-screenshots').getPublicUrl(filePath);
        screenshotUrl = urlData.publicUrl;
      } catch (uploadError) {
        errEl.textContent = 'Screenshot upload failed: ' + uploadError.message;
        errEl.classList.remove('hidden');
        if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
        return;
      }
    }
  }

  const items = lines.map(([key, qty]) => {
    const line = resolveCartLine(key);
    return { name: line.name, price: line.price, qty };
  }).filter(Boolean);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryCharge = Number(SETTINGS?.delivery_charge || 0);
  const total = subtotal + deliveryCharge;

  const { data: orderId, error: idErr } = await supabaseClient.rpc('get_next_order_id');
  if (idErr) {
    errEl.textContent = 'Could not create order ID: ' + idErr.message;
    errEl.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
    return;
  }

  const { data: orderData, error: orderErr } = await supabaseClient.from('orders').insert({
    id: orderId,
    customer_id: CUSTOMER.id,
    customer_name: CUSTOMER.name,
    customer_phone: CUSTOMER.phone,
    customer_location: CUSTOMER.location,
    items,
    delivery_charge: deliveryCharge,
    total,
    payment_method: method,
    payment_screenshot_url: screenshotUrl,
    payment_proof: paymentProofText,
  }).select().single();

  if (orderErr) {
    errEl.textContent = 'Could not place order: ' + orderErr.message;
    errEl.classList.remove('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
    return;
  }

  Object.keys(cart).forEach(k => cart[k] = 0);
  document.getElementById('cartPanel').classList.add('hidden');
  const scrInput = document.getElementById('screenshotInput');
  if (scrInput) scrInput.value = '';
  loadMenu();

  document.getElementById('confirmOrderId').textContent = '#' + orderData.id;
  document.getElementById('confirmPanel').classList.remove('hidden');
  loadMyOrders();
  if (orderData.rider_name) {
    document.getElementById('riderName').textContent = orderData.rider_name;
    document.getElementById('riderPhone').textContent = orderData.rider_phone || '';
    document.getElementById('riderInfo').classList.remove('hidden');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
}

async function loadChat() {
  if (!CUSTOMER) return;
  const { data } = await supabaseClient
  .from('chat_messages').select('*').eq('customer_id', CUSTOMER.id).order('created_at');
  renderChat(data || []);
}
function renderChat(messages) {
  const box = document.getElementById('chatBox');
  box.innerHTML = messages.map(m =>
    `<div class="chat-msg ${m.sender}" data-msg-id="${m.id}">${m.message}</div>`
  ).join('');
  box.scrollTop = box.scrollHeight;
}
async function sendChatMessage() {
  if (!CUSTOMER) {
    alert('Please log in or create an account first to chat with us.');
    return;
  }
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  await supabaseClient.from('chat_messages').insert({
    customer_id: CUSTOMER.id, sender: 'customer', message
  });
  loadChat();
}

let chatChannel = null;
function subscribeChat() {
  if (!CUSTOMER) return;
  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }
  chatChannel = supabaseClient.channel('customer-chat-' + CUSTOMER.id)
   .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'chat_messages',
      filter: `customer_id=eq.${CUSTOMER.id}`
    }, payload => {
      const m = payload.new;
      const box = document.getElementById('chatBox');
      // avoid double-adding a message we already rendered
      if (box.querySelector(`[data-msg-id="${m.id}"]`)) return;
      const div = document.createElement('div');
      div.className = `chat-msg ${m.sender}`;
      div.dataset.msgId = m.id;
      div.textContent = m.message;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
      if (m.sender === 'admin') {
        notifyBrowser('New message from Home Kitchen', m.message);
      }
    }).subscribe();
}

(async function init() {
  initNotifications();
  await loadSettings();
  await loadMenu();
  await restoreSession(); // this now also opens the chat realtime channel via setCustomer()
})();
