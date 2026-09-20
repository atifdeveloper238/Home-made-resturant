let audioCtx = null;
let currentSource = null;

async function playLoud() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const res = await fetch(chrome.runtime.getURL('notification.mp3'));
  const buf = await res.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(buf);

  if (currentSource) { try { currentSource.stop(); } catch(e){} }

  const source = audioCtx.createBufferSource();
  source.buffer = decoded;
  source.loop = true;

  const gain = audioCtx.createGain();
  gain.gain.value = 4.5; // <-- YAHAN SE VOLUME CONTROL HOGA. 1.0 = normal, 4.5 = 450% loud, aap 6.0 tak kar sakte ho

  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start(0);
  currentSource = source;
}

function stopLoud() {
  if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource = null; }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'playLoud') playLoud();
  if (msg.action === 'stopLoud') stopLoud();
});
