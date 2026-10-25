// Tap to hear: with ../shared/audio.js (which does the playing) the only script on the published page
// (tools/build_site.py keeps these and drops the drawing code).
// Anything with data-file="…" plays that recording (the song); data-say="…" plays the recording of that text;
// tapping what is playing stops it. All sounds are made by tools/make_sounds.py into the week's audio/ folder: words and sentences (listed in audio/voice.js), letter sounds (sound-x.m4a) and blends
// (blend-word.m4a). Anything not recorded yet falls back to the device's English voice.

useVoice('en-US', 0.8, 'Samantha');

// play a list of steps one after another: { file } = an audio clip, { text } = the recording of that text, or read
// aloud by the device. Only one thing plays at a time; while it plays its element has the class "is-playing".
async function play(steps, el) {
  stop();
  nowEl = el;
  el.classList.add('is-playing');
  for (const st of steps) {
    const spoken = !st.file && !files()[st.text];   // the device's voice: a short breath after it
    if (!(await say(st.text, st.file)) || spoken && !(await pause(150))) return;
  }
  stop();
}

function onTap(e) {
  // the outer thing wins: a letter inside an I-spy chip or a sound card belongs to that chip / card
  const t = e.target, el = t.closest('[data-file]') || t.closest('[data-spy]') || t.closest('[data-key]') || t.closest('[data-blend]') || t.closest('[data-say]');
  if (!el) return;
  if (el === nowEl) { stop(); return; }   // tap again to stop (e.g. the song)
  const txt = el.dataset.say, single = txt && /^[a-z]$/.test(txt);
  let steps;
  if (el.dataset.file) steps = [{ file: el.dataset.file }];   // a recording, e.g. the song
  else if (el.dataset.spy) steps = [{ text: 'I spy something that starts with...' }, { file: `sound-${el.dataset.spy}.m4a` }];
  else if (el.dataset.blend) steps = [{ file: `blend-${el.dataset.blend}.m4a` }];
  else if (single && el.dataset.key) steps = [{ file: `sound-${txt}.m4a` }, { text: el.dataset.key }];   // "sss … snake"
  else if (single) steps = [{ file: `sound-${txt}.m4a` }];
  else steps = [{ text: txt }];
  play(steps, el);
  if (el.hasAttribute('data-hit')) el.classList.add('hit');   // I spy: a right answer turns green
  if (el.querySelector('.mv')) act(el);
}

// an action picture moves once when tapped (week.css: .acting .mv-…), tapping again starts it over
function act(el) {
  el.classList.remove('acting');
  void el.offsetWidth;   // restart the animation
  el.classList.add('acting');
  clearTimeout(el.actTimer);
  el.actTimer = setTimeout(() => el.classList.remove('acting'), 3000);
}

document.addEventListener('click', onTap);
// tap the "?" card to see the picture (only after blending the word)
document.addEventListener('click', (e) => { const b = e.target.closest('.reveal'); if (b) b.classList.toggle('open'); });
