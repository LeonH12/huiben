// Playing sound, shared by the players of every series (逻辑世界, 文字王国, 诗词世界): load it right before player.js.
// One thing plays at a time: a recording when there is one (audio/voice.js says which text plays which file:
// VOICE_FILES), else the device's voice. The player says which voice with useVoice(lang, rate, name).
//
// iPad / iPhone Safari only lets a sound start inside a tap, unless the same audio element was already played by
// a tap. So everything plays through ONE element (audioEl), and the first sound of a tap must start inside the tap
// (no await or timeout before it); the sounds after it may then follow on their own.

const AUDIO_DIR = 'audio/';
const files = () => (typeof VOICE_FILES !== 'undefined' ? VOICE_FILES : {});

// the device's voice, for what is not recorded yet: the voice named `name` if the device has it, else one for `lang`
let voiceLang = 'zh-CN', voiceRate = 0.9, voiceName = null, deviceVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  deviceVoice = vs.find((v) => v.name === voiceName) || vs.find((v) => v.lang === voiceLang)
    || vs.find((v) => v.lang.startsWith(voiceLang.slice(0, 2))) || null;
}
/** @param {string} lang e.g. 'zh-CN'  @param {number} rate  @param {string | null} [name] */
function useVoice(lang, rate, name = null) {
  voiceLang = lang; voiceRate = rate; voiceName = name;
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
}

// iPad / iPhone: play like a video, even when the device is on silent
if (navigator.audioSession) navigator.audioSession.type = 'playback';

// one element for everything: once a tap has played it, Safari lets it play on its own afterwards
const audioEl = new Audio();

// one thing plays at a time; stop() cancels everything that is waiting. While something plays, nowEl (the button
// or word that started it) has the class "is-playing". A player adds its own cleanup with onStop.push(fn).
let playId = 0, nowEl = null;
const onStop = [];
function stop() {
  playId++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  audioEl.pause();
  if (nowEl) nowEl.classList.remove('is-playing');
  nowEl = null;
  onStop.forEach((fn) => fn());
}
// wait ms; resolves false if stop() came meanwhile
const pause = (ms) => { const id = playId; return new Promise((r) => setTimeout(() => r(id === playId), ms)); };

// the browser refused to play without a tap: show the sound button, where the page has one
// (an AbortError only means the sound was stopped, e.g. a page was turned mid-play)
const blocked = (e) => { if (e && e.name === 'NotAllowedError') document.body.classList.add('muted'); };
const heard = () => document.body.classList.remove('muted');
// about how long a text takes to read, to wait when the sound was refused (a Chinese character is slower than a letter)
const readTime = (text) => (text || '').length * (voiceLang.startsWith('zh') ? 250 : 70);

// play the sound file given, or the recording of text (the device's voice if it is not recorded yet);
// resolves true when it ends, false if this play was cancelled
/** @param {string | null} text  @param {string} [file]  @returns {Promise<boolean>} */
function say(text, file) {
  const id = playId;
  return new Promise((done) => {
    if (id !== playId || !(text || file)) return done(id === playId);
    file = file || files()[text];
    if (file) {
      const a = audioEl;
      a.src = AUDIO_DIR + file;
      a.muted = false; a.onseeked = a.onloadedmetadata = null;   // left over from a take
      a.onended = a.onerror = () => done(id === playId);
      // playing refused (the browser wants a tap first): show the sound button, and still wait about as long as
      // the text, so the pictures keep the pace of the reading
      a.play().then(heard).catch((e) => { blocked(e); setTimeout(() => done(id === playId), readTime(text)); });
    } else {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voiceLang; u.rate = voiceRate;
      if (deviceVoice) u.voice = deviceVoice;
      u.onend = u.onerror = () => done(id === playId);
      speechSynthesis.speak(u);
    }
  });
}

// play seconds from–to of a long recording (a take: 逻辑世界 reads a page in one go); onTime(t) is called on every
// frame while it plays. Resolves like say().
/** @param {string} file  @param {number} from  @param {number} to  @param {(t: number) => void} [onTime]  @returns {Promise<boolean>} */
function playTake(file, from, to, onTime) {
  const id = playId;
  return new Promise((done) => {
    if (id !== playId) return done(false);
    const a = audioEl;
    // jump to `from` ourselves (a "#t=from,to" address stops Chrome about a second after a mid-file start);
    // until the jump lands the element stays muted, so the start of the take is never heard
    const url = new URL(AUDIO_DIR + file, location.href).href;
    if (a.src !== url) a.src = url;
    const seek = () => { if (Math.abs(a.currentTime - from) > 0.05) a.currentTime = from; else a.muted = false; };
    a.muted = from > 0.05;
    a.onseeked = () => { a.muted = false; };
    if (a.readyState >= 1) seek(); else a.onloadedmetadata = seek;
    let over = false;
    const finish = (ok) => { if (!over) { over = true; done(ok && id === playId); } };
    const tick = () => {
      if (over) return;
      if (id !== playId) return finish(false);
      const t = a.currentTime;
      if (t >= from - 0.1) {   // not before the jump has landed
        if (onTime) onTime(t);
        if (a.ended || t >= to - 0.03) { a.pause(); return finish(true); }
      }
      requestAnimationFrame(tick);
    };
    a.onended = a.onerror = () => finish(true);
    a.play().then(() => { heard(); requestAnimationFrame(tick); })
      .catch((e) => { blocked(e); setTimeout(() => finish(true), (to - from) * 1000); });
  });
}
