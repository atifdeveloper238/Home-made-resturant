// اجازت لینا
if ("Notification" in window) {
  Notification.requestPermission();
}

function phoneParNotificationBhejo(name) {
  if (Notification.permission === "granted") {
    new Notification("نیا آرڈر آیا ہے!", {
      body: name + " نے نیا آرڈر دیا ہے",
      icon: "/icon-192x192.png"
    });
  }
  // آواز کے لیے
  let audio = new Audio("https://assets.mixkit.co/sfx/preview/mixkit-correct-answer-tone-2870.mp3");
  audio.play().catch(()=>{});
}
// ============================================================
// ADMIN DASHBOARD LOGIC
// UPDATED: riders tab, edit-in-place for menu items, size variants,
// notifications for new orders/chats, compression retargeted to
// 2-3KB, duplicate payment-info render bug removed.
// ============================================================

let CURRENT_CHAT_CUSTOMER = null;
let RIDERS_CACHE = [];

// ---- IMAGE COMPRESS (targets 2-3KB output, as requested) ----
// NOTE: 2-3KB is very small for a real photo — roughly 100-150px
// wide and visibly soft at that size. If menu photos need to stay
// appetizing, consider raising this (search "targetKB:" below).
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

// ---- NOTIFICATIONS (foreground/open-tab) ----
// For alerts while this admin tab/PWA is actually open. For alerts
// when the admin app is fully closed, use the Chrome extension
// (background.js) included alongside these files — that one polls
// Supabase independently of any open tab.
function initNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
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
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) { /* ignore */ }
}

// ---- AUTH ----
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  const errEl = document.getElementById('loginError');
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove('hidden');
    return;
  }
  showDashboard();
}

async function doLogout() {
  await supabaseClient.auth.signOut();
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

async function checkSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) showDashboard();
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  initNotifications();
  loadOrders();
  loadMenuManage();
  loadSettingsForm();
  loadChatCustomerList();
  loadRiders();
  subscribeOrderUpdates();
}

// ---- TABS ----
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

// ---- ORDERING ON/OFF ----
async function toggleOrdering() {
  const enabled = document.getElementById('orderingToggle').checked;
  await supabaseClient.from('settings').update({ ordering_enabled: enabled }).eq('id', 1);
}

// ---- RIDERS ----
async function loadRiders() {
  const { data } = await supabaseClient.from('riders').select('*').order('name');
  RIDERS_CACHE = data || [];
  const list = document.getElementById('ridersList');
  if (list) {
    list.innerHTML = RIDERS_CACHE.length === 0
      ? '<p class="muted">No riders added yet.</p>'
      : RIDERS_CACHE.map(r => `
          <div class="order-card-top" style="padding:8px 0; border-bottom:1px solid var(--line)">
            <span><strong>${r.name}</strong> — ${r.phone}</span>
            <button class="btn-outline btn" onclick="deleteRider('${r.id}')">Delete</button>
          </div>
        `).join('');
  }
  // keep every order's rider dropdown in sync with the roster
  document.querySelectorAll('.rider-select').forEach(sel => {
    const currentVal = sel.value;
    sel.innerHTML = riderOptionsHtml() ;
    sel.value = currentVal;
  });
}

function riderOptionsHtml(selectedName) {
  return `<option value="">— assign a rider —</option>` +
    RIDERS_CACHE.map(r => `<option value="${r.id}" ${r.name === selectedName ? 'selected' : ''}>${r.name} (${r.phone})</option>`).join('');
}

async function addRider() {
  const name = document.getElementById('newRiderName').value.trim();
  const phone = document.getElementById('newRiderPhone').value.trim();
  if (!name || !phone) { alert('Please enter both name and phone number.'); return; }
  const { error } = await supabaseClient.from('riders').insert({ name, phone });
  if (error) { alert('Could not add rider: ' + error.message); return; }
  document.getElementById('newRiderName').value = '';
  document.getElementById('newRiderPhone').value = '';
  loadRiders();
}

async function deleteRider(id) {
  if (!confirm('Remove this rider from the list?')) return;
  await supabaseClient.from('riders').delete().eq('id', id);
  loadRiders();
}

async function assignRiderToOrder(orderId, riderId) {
  if (!riderId) return;
  const rider = RIDERS_CACHE.find(r => r.id === riderId);
  if (!rider) return;
  await supabaseClient.from('orders').update({ rider_name: rider.name, rider_phone: rider.phone }).eq('id', orderId);
}

// ---- ORDERS ----
async function loadOrders() {
  const { data, error } = await supabaseClient.from('orders').select('*').order('id', { ascending: false });
  const list = document.getElementById('ordersList');
  if (error || !data || data.length === 0) {
    list.innerHTML = '<p class="muted">No orders yet.</p>';
    return;
  }
  list.innerHTML = data.map(o => `
    <div class="order-card">
      <div class="order-card-top">
        <strong>Order #${o.id}</strong>
        <span class="status ${o.status}">${o.status}</span>
      </div>
      <p class="muted">${new Date(o.created_at).toLocaleString()}</p>
      <p><strong>${o.customer_name}</strong> — ${o.customer_phone}</p>
      <p class="muted">${o.customer_location}</p>
      ${o.items.map(i => `<div class="panel-row"><span>${i.name} × ${i.qty}</span><span>Rs. ${i.price * i.qty}</span></div>`).join('')}
      <div class="panel-row total"><span>Total</span><span>Rs. ${o.total}</span></div>
      <p class="muted">Payment: ${o.payment_method}${o.payment_screenshot_url ? ` — <a href="${o.payment_screenshot_url}" target="_blank">view screenshot</a> — <a href="#" onclick="deleteScreenshot(${o.id}, '${o.payment_screenshot_url}'); return false;" style="color:#B4531E">delete screenshot</a>` : ''}</p>
      ${o.payment_proof ? `<div style="background:#e6ffed; padding:6px; border-radius:6px; margin:5px 0; color:green; font-weight:bold; font-size:13px;">${o.payment_proof}</div>` : ''}

      <label>Status</label>
      <select onchange="updateOrderStatus(${o.id}, this.value)">
        ${['pending','confirmed','preparing','out_for_delivery','delivered','cancelled'].map(s =>
          `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>

      <label>Assign rider</label>
      <select class="rider-select" onchange="assignRiderToOrder(${o.id}, this.value)">
        ${riderOptionsHtml(o.rider_name)}
      </select>
      <label>Rider name</label>
      <input type="text" value="${o.rider_name || ''}" onblur="updateRider(${o.id}, this.value, null)">
      <label>Rider phone</label>
      <input type="text" value="${o.rider_phone || ''}" onblur="updateRider(${o.id}, null, this.value)">
      <button class="btn btn-outline" style="margin-top:10px" onclick="printReceipt(${o.id})">Print receipt</button>
    </div>
  `).join('');
}

async function updateOrderStatus(id, status) {
  await supabaseClient.from('orders').update({ status }).eq('id', id);
}

async function updateRider(id, name, phone) {
  const update = {};
  if (name !== null) update.rider_name = name;
  if (phone !== null) update.rider_phone = phone;
  await supabaseClient.from('orders').update(update).eq('id', id);
}

function subscribeOrderUpdates() {
  supabaseClient.channel('admin-orders')
   .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
      loadOrders();
      const o = payload.new;
      notifyBrowser(`New order #${o.id}`, `${o.customer_name} — Rs. ${o.total}`);
    })
   .subscribe();
}

let printerChar = null;
async function printReceipt(id) {
  const { data } = await supabaseClient.from('orders').select('*').eq('id', id).single();
  if (!data) return;

  // --- BLUETOOTH THERMAL PRINT LOGIC ---
  try {
    if (!printerChar) {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'battery_service']
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      printerChar = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
    }

    let itemsText = "";
    try {
      itemsText = data.items.map(i => `${i.name} x${i.qty} = Rs.${i.price * i.qty}`).join('\n');
    } catch(e) { itemsText = JSON.stringify(data.items); }

    let bill = `      DIVOR FOODS\n   HOME KITCHEN Sargodha\n------------------------------\nOrder #${data.id}\n${new Date(data.created_at).toLocaleString()}\n------------------------------\n${data.customer_name} - ${data.customer_phone}\n${data.customer_location}\n------------------------------\n${itemsText}\nDelivery: Rs.${data.delivery_charge}\n------------------------------\nTOTAL: Rs.${data.total}\nPayment: ${data.payment_method}\n------------------------------\n        Shukria!\n\n\n`;

    let encoded = new TextEncoder().encode(bill);
    for (let i = 0; i < encoded.length; i += 100) {
      await printerChar.writeValue(encoded.slice(i, i + 100));
    }
    return;

  } catch (err) {
    console.log("Bluetooth fail, normal print:", err);
  }

  document.getElementById('receipt').innerHTML = `
    <div style="text-align:center; font-weight:bold;">HOME KITCHEN</div>
    <div>Order #${data.id}</div>
    <div>${new Date(data.created_at).toLocaleString()}</div>
    <hr>
    <div>${data.customer_name} - ${data.customer_phone}</div>
    <div>${data.customer_location}</div>
    <hr>
    ${data.items.map(i => `<div>${i.name} x${i.qty} - Rs.${i.price * i.qty}</div>`).join('')}
    <div>Delivery - Rs.${data.delivery_charge}</div>
    <hr>
    <div style="font-weight:bold">TOTAL: Rs.${data.total}</div>
    <div>Payment: ${data.payment_method}</div>
    ${data.rider_name ? `<div>Rider: ${data.rider_name} ${data.rider_phone || ''}</div>` : ''}
  `;
  window.print();
}

// ---- PDF EXPORT ----
async function downloadOrdersPDF() {
  const { data } = await supabaseClient.from('orders').select('*').order('id');
  if (!data || data.length === 0) { alert('No orders to export.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 15;
  doc.setFontSize(14);
  doc.text('Order History', 14, y);
  y += 10;
  doc.setFontSize(10);
  data.forEach(o => {
    if (y > 270) { doc.addPage(); y = 15; }
    doc.text(`#${o.id} ${o.customer_name} ${o.customer_phone} Rs.${o.total} [${o.status}] ${new Date(o.created_at).toLocaleDateString()}`, 14, y);
    y += 6;
    o.items.forEach(i => {
      doc.text(` - ${i.name} x${i.qty} = Rs.${i.price * i.qty}`, 14, y);
      y += 5;
    });
    y += 3;
  });
  doc.save('orders.pdf');
}

async function deleteAllOrders() {
  if (!confirm('Delete ALL orders AND their payment screenshots permanently? This cannot be undone. Consider downloading the PDF first.')) return;
  const { data: files } = await supabaseClient.storage.from('payment-screenshots').list();
  if (files && files.length > 0) {
    const paths = files.map(f => f.name);
    await supabaseClient.storage.from('payment-screenshots').remove(paths);
  }
  await supabaseClient.from('orders').delete().neq('id', -1);
  loadOrders();
}

async function deleteScreenshot(orderId, screenshotUrl) {
  if (!confirm('Delete this payment screenshot? The order will stay, just without the image.')) return;
  const fileName = screenshotUrl.split('/').pop();
  await supabaseClient.storage.from('payment-screenshots').remove([fileName]);
  await supabaseClient.from('orders').update({ payment_screenshot_url: null }).eq('id', orderId);
  loadOrders();
}

async function resetOrderIdCounter() {
  if (!confirm('Reset the order ID counter back to 0? New orders will start from #0 again.')) return;
  await supabaseClient.rpc('reset_order_id_counter');
  alert('Order ID counter reset.');
}

// ---- MENU MANAGEMENT (variants + edit-in-place) ----
function toggleVariantFields() {
  const checked = document.getElementById('newItemHasVariants').checked;
  document.getElementById('variantFieldsBlock').classList.toggle('hidden', !checked);
  document.getElementById('simplePriceBlock').classList.toggle('hidden', checked);
}

async function loadMenuManage() {
  const { data } = await supabaseClient.from('menu_items').select('*').order('created_at');
  const list = document.getElementById('menuManageList');
  if (!data || data.length === 0) { list.innerHTML = '<p class="muted">No menu items yet.</p>'; return; }

  const variantItemIds = data.filter(i => i.has_variants).map(i => i.id);
  let variantsByItem = {};
  if (variantItemIds.length > 0) {
    const { data: variantRows } = await supabaseClient
      .from('menu_item_variants').select('*').in('menu_item_id', variantItemIds).order('sort_order');
    (variantRows || []).forEach(v => {
      if (!variantsByItem[v.menu_item_id]) variantsByItem[v.menu_item_id] = [];
      variantsByItem[v.menu_item_id].push(v);
    });
  }

  list.innerHTML = data.map(item => {
    const variants = variantsByItem[item.id] || [];
    return `
    <div class="order-card" id="menu-card-${item.id}">
      <div id="menu-view-${item.id}">
        <div class="order-card-top">
          <strong>${item.name}</strong>
          <label class="switch">
            <input type="checkbox" ${item.available ? 'checked' : ''} onchange="toggleItemAvailable('${item.id}', this.checked)">
            <span class="slider"></span>
          </label>
        </div>
        <p class="muted">${item.description || ''}${item.has_variants ? '' : ` — Rs. ${item.price}`}</p>
        ${item.photo_url ? `<img src="${item.photo_url}" style="width:60px;height:60px;object-fit:cover">` : ''}
        ${item.has_variants ? `
          <div class="variant-list" style="margin-top:8px">
            ${variants.map(v => `<div class="muted" style="font-size:0.85rem">${v.variant_name} — Rs. ${v.price}${v.description ? ' — ' + v.description : ''}</div>`).join('')}
          </div>` : ''}
        <div style="margin-top:8px; display:flex; gap:8px;">
          <button class="btn-outline btn" onclick="showMenuEditForm('${item.id}')">Edit</button>
          <button class="btn-outline btn" onclick="deleteMenuItem('${item.id}')">Delete</button>
        </div>
      </div>
      <div id="menu-edit-${item.id}" class="hidden" style="margin-top:10px">
        <label>Name</label>
        <input id="edit-name-${item.id}" type="text" value="${item.name}">
        <label>Description</label>
        <input id="edit-desc-${item.id}" type="text" value="${item.description || ''}">
        ${item.has_variants ? `
          <div style="margin-top:8px">
            ${variants.map((v, idx) => `
              <div style="border-top:1px solid var(--line); padding-top:8px; margin-top:8px">
                <label>Variant ${idx + 1} name</label>
                <input id="edit-variant-name-${v.id}" type="text" value="${v.variant_name}">
                <label>Price (Rs.)</label>
                <input id="edit-variant-price-${v.id}" type="number" value="${v.price}">
                <label>One-line description</label>
                <input id="edit-variant-desc-${v.id}" type="text" value="${v.description || ''}">
              </div>
            `).join('')}
          </div>
        ` : `
          <label>Price (Rs.)</label>
          <input id="edit-price-${item.id}" type="number" value="${item.price || 0}">
        `}
        <div style="margin-top:10px; display:flex; gap:8px;">
          <button class="btn" onclick="saveMenuItemEdit('${item.id}', ${item.has_variants ? 'true' : 'false'}, ${JSON.stringify(variants.map(v => v.id))})">Save</button>
          <button class="btn-outline btn" onclick="hideMenuEditForm('${item.id}')">Cancel</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

function showMenuEditForm(id) {
  document.getElementById(`menu-view-${id}`).classList.add('hidden');
  document.getElementById(`menu-edit-${id}`).classList.remove('hidden');
}
function hideMenuEditForm(id) {
  document.getElementById(`menu-view-${id}`).classList.remove('hidden');
  document.getElementById(`menu-edit-${id}`).classList.add('hidden');
}

async function saveMenuItemEdit(id, hasVariants, variantIds) {
  const name = document.getElementById(`edit-name-${id}`).value.trim();
  const description = document.getElementById(`edit-desc-${id}`).value.trim();
  if (!name) { alert('Name cannot be empty.'); return; }

  const update = { name, description };
  if (!hasVariants) {
    const price = parseFloat(document.getElementById(`edit-price-${id}`).value);
    if (!Number.isFinite(price) || price <= 0) { alert('Please enter a valid price.'); return; }
    update.price = price;
  }
  const { error } = await supabaseClient.from('menu_items').update(update).eq('id', id);
  if (error) { alert('Could not save changes: ' + error.message); return; }

  if (hasVariants && variantIds && variantIds.length > 0) {
    for (const vId of variantIds) {
      const vName = document.getElementById(`edit-variant-name-${vId}`).value.trim();
      const vPrice = parseFloat(document.getElementById(`edit-variant-price-${vId}`).value);
      const vDesc = document.getElementById(`edit-variant-desc-${vId}`).value.trim();
      if (!vName || !Number.isFinite(vPrice) || vPrice <= 0) continue;
      await supabaseClient.from('menu_item_variants')
        .update({ variant_name: vName, price: vPrice, description: vDesc })
        .eq('id', vId);
    }
  }

  await loadMenuManage();
}

async function addMenuItem() {
  const name = document.getElementById('newItemName').value.trim();
  const description = document.getElementById('newItemDesc').value.trim();
  const hasVariants = document.getElementById('newItemHasVariants').checked;
  const price = hasVariants ? null : parseFloat(document.getElementById('newItemPrice').value);
  const fileInput = document.getElementById('newItemPhoto');
  const btn = document.querySelector('[onclick="addMenuItem()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }

  if (!name) {
    alert('Please enter a name.');
    if (btn) { btn.disabled = false; btn.textContent = 'Add Item'; }
    return;
  }
  if (!hasVariants && (!Number.isFinite(price) || price <= 0)) {
    alert('Please enter a valid price.');
    if (btn) { btn.disabled = false; btn.textContent = 'Add Item'; }
    return;
  }

  let variantInputs = [];
  if (hasVariants) {
    const names = ['Standard', 'Small', 'Large'];
    for (let i = 0; i < 3; i++) {
      const vName = document.getElementById(`newVariantName${i}`).value.trim() || names[i];
      const vPrice = parseFloat(document.getElementById(`newVariantPrice${i}`).value);
      const vDesc = document.getElementById(`newVariantDesc${i}`).value.trim();
      if (!Number.isFinite(vPrice) || vPrice <= 0) {
        alert(`Please enter a valid price for the "${vName}" variant.`);
        if (btn) { btn.disabled = false; btn.textContent = 'Add Item'; }
        return;
      }
      variantInputs.push({ variant_name: vName, price: vPrice, description: vDesc, sort_order: i });
    }
  }

  let photo_url = null;

  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      if (btn) { btn.disabled = false; btn.textContent = 'Add Item'; }
      return;
    }

    try {
      if (btn) btn.textContent = 'Compressing...';
      const compressedFile = await compressImage(file, 3, 2); // targets ~2-3KB

      const extension = 'jpg';
      const filePath = `menu_${Date.now()}_${crypto.randomUUID()}.${extension}`;

      if (btn) btn.textContent = 'Uploading...';
      const { error: uploadError } = await supabaseClient.storage.from('menu-photos').upload(filePath, compressedFile, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/jpeg'
      });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabaseClient.storage.from('menu-photos').getPublicUrl(filePath);
      photo_url = publicData.publicUrl;

    } catch (e) {
      console.error('Menu photo upload error:', e);
      alert('Photo upload failed: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Add Item'; }
      return;
    }
  }

  const { data: insertedItem, error: insertError } = await supabaseClient.from('menu_items').insert({
    name, description, price, photo_url, available: true, has_variants: hasVariants
  }).select().single();

  if (insertError) {
    console.error('Menu item insert error:', insertError);
    if (photo_url) {
      try {
        const fileName = photo_url.split('/').pop();
        await supabaseClient.storage.from('menu-photos').remove([fileName]);
      } catch (cleanupError) {
        console.warn('Could not remove unused uploaded photo:', cleanupError);
      }
    }
    alert('Could not add menu item: ' + insertError.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Add Item'; }
    return;
  }

  if (hasVariants && insertedItem) {
    const rows = variantInputs.map(v => ({ ...v, menu_item_id: insertedItem.id }));
    const { error: variantError } = await supabaseClient.from('menu_item_variants').insert(rows);
    if (variantError) {
      alert('Item was added, but variants failed to save: ' + variantError.message);
    }
  }

  document.getElementById('newItemName').value = '';
  document.getElementById('newItemDesc').value = '';
  document.getElementById('newItemPrice').value = '';
  document.getElementById('newItemHasVariants').checked = false;
  toggleVariantFields();
  ['0','1','2'].forEach(i => {
    document.getElementById(`newVariantName${i}`).value = '';
    document.getElementById(`newVariantPrice${i}`).value = '';
    document.getElementById(`newVariantDesc${i}`).value = '';
  });
  if (fileInput) fileInput.value = '';
  if (btn) { btn.disabled = false; btn.textContent = 'Add Item'; }
  alert('Menu item added successfully.');
  await loadMenuManage();
}

async function toggleItemAvailable(id, available) {
  await supabaseClient.from('menu_items').update({ available }).eq('id', id);
}
async function deleteMenuItem(id) {
  if (!confirm('Delete this menu item?')) return;
  await supabaseClient.from('menu_items').delete().eq('id', id);
  loadMenuManage();
}

// ---- SETTINGS ----
async function loadSettingsForm() {
  const { data } = await supabaseClient.from('settings').select('*').eq('id', 1).single();
  if (!data) return;
  document.getElementById('orderingToggle').checked = data.ordering_enabled;
  document.getElementById('setKitchenName').value = data.kitchen_name || '';
  document.getElementById('setKitchenPhone').value = data.kitchen_phone || '';
  document.getElementById('setKitchenLocation').value = data.kitchen_location || '';
  document.getElementById('setKitchenDesc').value = data.kitchen_description || '';
  document.getElementById('setEpName').value = data.easypaisa_account_name || '';
  document.getElementById('setEpNumber').value = data.easypaisa_account_number || '';
  document.getElementById('setDeliveryCharge').value = data.delivery_charge || 0;
}
async function saveSettings() {
  const update = {
    kitchen_name: document.getElementById('setKitchenName').value.trim(),
    kitchen_phone: document.getElementById('setKitchenPhone').value.trim(),
    kitchen_location: document.getElementById('setKitchenLocation').value.trim(),
    kitchen_description: document.getElementById('setKitchenDesc').value.trim(),
    easypaisa_account_name: document.getElementById('setEpName').value.trim(),
    easypaisa_account_number: document.getElementById('setEpNumber').value.trim(),
    delivery_charge: parseFloat(document.getElementById('setDeliveryCharge').value) || 0
  };
  await supabaseClient.from('settings').update(update).eq('id', 1);
  const saved = document.getElementById('settingsSaved');
  saved.classList.remove('hidden');
  setTimeout(() => saved.classList.add('hidden'), 2000);
}

// ---- ADMIN CHAT ----
async function loadChatCustomerList() {
  const { data } = await supabaseClient.from('chat_messages').select('customer_id, message, created_at, customers(name, phone)').order('created_at', { ascending: false });
  const listEl = document.getElementById('chatCustomerList');
  if (!data || data.length === 0) { listEl.innerHTML = '<p class="muted">No customer chats yet.</p>'; return; }
  const seen = new Set();
  const uniqueCustomers = [];
  data.forEach(m => {
    if (!seen.has(m.customer_id)) { seen.add(m.customer_id); uniqueCustomers.push(m); }
  });
  listEl.innerHTML = '<h3>Conversations</h3>' + uniqueCustomers.map(m => `
    <div style="padding:8px 0; border-bottom:1px solid var(--line); cursor:pointer" onclick="openChat('${m.customer_id}', '${(m.customers?.name || 'Customer').replace(/'/g, "\\'")}')">
      <strong>${m.customers?.name || 'Customer'}</strong> <span class="muted">${m.customers?.phone || ''}</span>
      <p class="muted" style="margin:2px 0 0">${m.message.slice(0, 50)}</p>
    </div>
  `).join('');
}
async function openChat(customerId, customerName) {
  CURRENT_CHAT_CUSTOMER = customerId;
  document.getElementById('adminChatWindow').classList.remove('hidden');
  document.getElementById('chatWithName').textContent = 'Chat with ' + customerName;
  loadAdminChatMessages();
}
async function loadAdminChatMessages() {
  if (!CURRENT_CHAT_CUSTOMER) return;
  const { data } = await supabaseClient.from('chat_messages').select('*').eq('customer_id', CURRENT_CHAT_CUSTOMER).order('created_at');
  const box = document.getElementById('adminChatBox');
  box.innerHTML = (data || []).map(m => `<div class="chat-msg ${m.sender}" data-msg-id="${m.id}">${m.message}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}
async function sendAdminReply() {
  const input = document.getElementById('adminChatInput');
  const message = input.value.trim();
  if (!message || !CURRENT_CHAT_CUSTOMER) return;
  input.value = '';

  // Insert only — the realtime subscription below adds it to the UI,
  // for both the admin's own window and (via customer.js) the customer's.
  await supabaseClient.from('chat_messages').insert({
    customer_id: CURRENT_CHAT_CUSTOMER,
    sender: 'admin',
    message
  });
}
function subscribeAdminChat() {
  supabaseClient.channel('admin-chat-all')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
      loadChatCustomerList();
      const m = payload.new;
      if (CURRENT_CHAT_CUSTOMER && m.customer_id === CURRENT_CHAT_CUSTOMER) {
        const box = document.getElementById('adminChatBox');
        if (box.querySelector(`[data-msg-id="${m.id}"]`)) return;
        const div = document.createElement('div');
        div.className = `chat-msg ${m.sender}`;
        div.dataset.msgId = m.id;
        div.textContent = m.message;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
      }
      if (m.sender === 'customer') {
        notifyBrowser('New customer message', m.message);
      }
    }).subscribe();
}


// ---- INIT ----
checkSession();
subscribeAdminChat();
