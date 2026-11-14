/**
 * audio.js — every sound is synthesized with WebAudio: no audio files,
 * no network. The context is created on the first user gesture; before
 * that (and in screenshot mode) every call is a silent no-op.
 */
export function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    enabled: true,
  };

  audio.unlock = () => {
    if (audio.ctx) {
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audio.ctx = new Ctx();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.35;
      audio.master.connect(audio.ctx.destination);
    } catch {
      audio.ctx = null;
    }
  };

  function noiseBuffer(dur) {
    const len = Math.floor(audio.ctx.sampleRate * dur);
    const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!audio.ctx || !audio.enabled) return;
    const t = audio.ctx.currentTime;
    const src = audio.ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filt = audio.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = filterFreq;
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(audio.master);
    src.start(t);
    src.stop(t + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!audio.ctx || !audio.enabled) return;
    const t = audio.ctx.currentTime;
    const osc = audio.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(audio.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  audio.shot = (kind) => {
    if (kind === 'rifle') { burst(0.12, 1800, 0.5); tone(160, 0.09, 0.25, 'square', 60); }
    else if (kind === 'smg') { burst(0.09, 2400, 0.4); tone(220, 0.07, 0.2, 'square', 80); }
    else if (kind === 'pistol') { burst(0.1, 1500, 0.45); tone(140, 0.08, 0.22, 'square', 55); }
    else burst(0.1, 1200, 0.3);
  };
  audio.dryFire = () => tone(900, 0.04, 0.12, 'square');
  audio.reload = () => { tone(500, 0.05, 0.15, 'square'); setTimeout(() => tone(700, 0.05, 0.15, 'square'), 160); };
  audio.hit = () => tone(1200, 0.06, 0.25, 'sine');
  audio.headshot = () => { tone(1500, 0.05, 0.25, 'sine'); setTimeout(() => tone(1900, 0.07, 0.25, 'sine'), 60); };
  audio.hurt = () => { tone(220, 0.12, 0.3, 'sawtooth', 120); };
  audio.plantBeep = () => tone(1000, 0.08, 0.2, 'sine');
  audio.planted = () => { tone(880, 0.15, 0.25, 'sine'); setTimeout(() => tone(1174, 0.2, 0.25, 'sine'), 140); };
  audio.defuseBeep = () => tone(1400, 0.06, 0.18, 'sine');
  audio.explosion = () => { burst(1.1, 300, 0.9); tone(90, 0.9, 0.5, 'sine', 35); };
  audio.roundWin = () => { tone(523, 0.14, 0.22, 'triangle'); setTimeout(() => tone(784, 0.22, 0.22, 'triangle'), 150); };
  audio.roundLose = () => { tone(392, 0.16, 0.2, 'triangle'); setTimeout(() => tone(262, 0.3, 0.2, 'triangle'), 170); };
  audio.buy = () => tone(660, 0.08, 0.2, 'triangle');
  audio.footstep = () => burst(0.05, 500, 0.08);
  return audio;
}
