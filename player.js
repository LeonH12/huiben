// Tap to hear: the only script on the published page (tools/build_site.py keeps this and drops the drawing code).
// Anything with data-file="…" plays that recording (the song); data-say="…" plays the recording of that text. All sounds are made by tools/make_sounds.py into the week's
// audio/ folder: words and sentences (listed in audio/voice.js), letter sounds (sound-x.m4a) and blends
// (blend-word.m4a). Anything not recorded yet falls back to the device's English voice.

const AUDIO_DIR = 'audio/';
let englishVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  englishVoice = vs.find((v) => v.name === 'Samantha') || vs.find((v) => v.lang === 'en-US') || vs.find((v) => v.lang.startsWith('en')) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

// play a list of steps one after another: { file } = an audio clip, { text } = read aloud
let playId = 0;
function play(steps) {
  const id = ++playId;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const next = (i) => {
    if (id !== playId || i >= steps.length) return;
    const st = steps[i];
    if (st.file) {
      next.file(st.file, i);
    } else if (typeof VOICE_FILES !== 'undefined' && VOICE_FILES[st.text]) {
      next.file(VOICE_FILES[st.text], i);
    } else {
      const u = new SpeechSynthesisUtterance(st.text);
      u.lang = 'en-US'; u.rate = 0.8;
      if (englishVoice) u.voice = englishVoice;
      u.onend = () => setTimeout(() => next(i + 1), 150);
      speechSynthesis.speak(u);
    }
  };
  next.file = (file, i) => {
    const a = new Audio(AUDIO_DIR + file);
    a.onended = () => next(i + 1);
    a.onerror = () => next(i + 1);
    a.play().catch(() => next(i + 1));
  };
  next(0);
}

function onTap(e) {
  // the outer thing wins: a letter inside an I-spy chip or a sound card belongs to that chip / card
  const t = e.target, el = t.closest('[data-file]') || t.closest('[data-spy]') || t.closest('[data-key]') || t.closest('[data-blend]') || t.closest('[data-say]');
  if (!el) return;
  const say = el.dataset.say, single = say && /^[a-z]$/.test(say);
  let steps;
  if (el.dataset.file) steps = [{ file: el.dataset.file }];   // a recording, e.g. the song
  else if (el.dataset.spy) steps = [{ text: 'I spy something that starts with...' }, { file: `sound-${el.dataset.spy}.m4a` }];
  else if (el.dataset.blend) steps = [{ file: `blend-${el.dataset.blend}.m4a` }];
  else if (single && el.dataset.key) steps = [{ file: `sound-${say}.m4a` }, { text: el.dataset.key }];   // "sss … snake"
  else if (single) steps = [{ file: `sound-${say}.m4a` }];
  else steps = [{ text: say }];
  play(steps);
  el.classList.add('playing');
  setTimeout(() => el.classList.remove('playing'), 600);
}

document.addEventListener('click', onTap);
// tap the "?" card to see the picture (only after blending the word)
document.addEventListener('click', (e) => { const b = e.target.closest('.reveal'); if (b) b.classList.toggle('open'); });
