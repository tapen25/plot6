// ===============================
// 1. 楽曲生成エンジン設定 (シンセ・コード)
// ===============================
const chords = [
  ["C3","E3","G3"], ["B2","D3","G3"], ["A2","C3","E3"], ["G2","B2","E3"],
  ["F2","A2","C3"], ["E2","G2","C3"], ["F2","A2","C3"], ["G2","B2","D3"]
];
const scales = [
  ["C4","D4","E4","G4","A4"], ["B3","D4","G4","A4","B4"],
  ["A3","C4","E4","G4","A4"], ["G3","B3","E4","G4","B4"],
  ["F3","A3","C4","F4","G4"], ["E3","G3","C4","E4","G4"],
  ["F3","A3","C4","F4","A4"], ["G3","B3","D4","G4","A4"]
];

const chordSynth = new Tone.PolySynth(Tone.Synth, { volume: -10 }).toDestination();
const melodySynth = new Tone.Synth({ oscillator: { type: "triangle" }, volume: -2 }).toDestination();
const kick = new Tone.MembraneSynth({ volume: -4 }).toDestination();
const snare = new Tone.NoiseSynth({ volume: -12, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).toDestination();
const hihat = new Tone.MetalSynth({
  volume: -15, harmonicity: 5.1, modulationIndex: 32,
  resonance: 4000, octaves: 1.5
}).toDestination();

let prevNote = "C4";

// ===============================
// 2. センサー変数
// ===============================
const motionBuffer = [];
const DURATION = 2000;
let sensorVariance = 0.0;
let smoothedVariance = 0.0;

let activity = 0.0;
let bpm = 90;

let isMouseMode = false;
let motionListenerAttached = false; // ← 追加：二重登録防止フラグ

// ===============================
// 3. メロディ生成
// ===============================
function nextNote(prev, candidates){
  const bias = 1 + activity * 4;
  let best = candidates[0];
  let bestScore = 999;
  for(const n of candidates){
    const midiPrev = Tone.Frequency(prev).toMidi();
    const midiN = Tone.Frequency(n).toMidi();
    const score = Math.abs(Math.abs(midiN - midiPrev) - bias);
    if(score < bestScore){ bestScore = score; best = n; }
  }
  return best;
}

// ===============================
// 4. センサー処理
// ===============================
function handleMotion(event) {
  const a = event.accelerationIncludingGravity;
  if (!a) return;

  const mag = Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z);
  const now = Date.now();

  motionBuffer.push({ t: now, m: mag });

  while (motionBuffer.length > 0 && motionBuffer[0].t < now - DURATION) {
    motionBuffer.shift();
  }

  if (motionBuffer.length < 5) {
    sensorVariance = 0;
    return;
  }

  const magnitudes = motionBuffer.map(d => d.m);
  const mean = magnitudes.reduce((s,v)=>s+v,0)/magnitudes.length;
  const variance = magnitudes.reduce((s,v)=>s+(v-mean)**2,0)/magnitudes.length;

  sensorVariance = Math.sqrt(variance);
}

// PCデバッグ：マウス位置を揺れとして扱う
document.addEventListener("mousemove", (e) => {
  // マウスモードは常にオンにするわけではなく、センサーが無い・許可されない場合のフォールバックとして機能
  if (!motionListenerAttached) {
    isMouseMode = true;
    sensorVariance = (e.clientX / window.innerWidth) * 8.0;
  }
});

// ===============================
// 5. メインループ
// ===============================
const SMOOTHING = 0.05;
const statusEl = document.getElementById('status');
const meterEl = document.getElementById('meter');

function updateParameters() {
  smoothedVariance += (sensorVariance - smoothedVariance) * SMOOTHING;

  let targetBpm = 90 + (smoothedVariance * 6);
  if (targetBpm > 150) targetBpm = 150;
  Tone.Transport.bpm.value = targetBpm;

  let rawActivity = smoothedVariance / 6.0;
  if (rawActivity > 1.0) rawActivity = 1.0;
  activity = rawActivity;

  statusEl.innerText = Math.round(targetBpm) + " BPM";
  meterEl.style.width = (activity * 100) + "%";

  requestAnimationFrame(updateParameters);
}
updateParameters();

// ===============================
// 6. 音楽スケジューリング
// ===============================
let musicSetupDone = false;
function setupMusic() {
  if (musicSetupDone) return; // 二重セット防止
  musicSetupDone = true;

  Tone.Transport.cancel(); // 念のため既存のスケジュールをクリア

  Tone.Transport.scheduleRepeat((time) => {
    const bar = Math.floor(Number(Tone.Transport.position.split(":")[0]) % 8);
    chordSynth.triggerAttackRelease(chords[bar], "1n", time);
  }, "1n");

  let tickCounter = 0;
  let nextNoteTick = 0;

  Tone.Transport.scheduleRepeat((time) => {
    if (tickCounter < nextNoteTick) { tickCounter++; return; }

    let step = (activity < 0.3) ? 4 : (activity > 0.7 ? 1 : 2);
    if(Math.random()>0.7) step *= 2;

    const duration = (step >= 4) ? "4n" : "8n";

    if (Math.random() > ((activity > 0.8) ? 0.1 : 0.2)) {
      const bar = Math.floor(tickCounter / 16) % 8;
      const next = nextNote(prevNote, scales[bar]);
      melodySynth.triggerAttackRelease(next, duration, time);
      prevNote = next;
    }

    nextNoteTick = tickCounter + step;
    tickCounter++;
  }, "16n");

  // --- Drums ---
  Tone.Transport.scheduleRepeat((time) => {
    const s = Math.floor(Tone.Transport.ticks / (Tone.Transport.PPQ / 4)) % 16;

    let k=false, n=false, h=false;

    if (activity < 0.3) {
      if (s===0 || s===8) k = true;
      if (s%4===0) h = true;
    } else if (activity < 0.7) {
      if (s===0 || s===10) k = true;
      if (s===4 || s===12) n = true;
      if (s%2===0) h = true;
    } else {
      if (s%4===0) k = true;
      if (s===4 || s===12) n = true;
      h = true;
    }

    if (k) kick.triggerAttackRelease("C1", "8n", time);
    if (n) snare.triggerAttackRelease("8n", time);
    if (h) hihat.triggerAttackRelease("32n", time, (s%4===0)?1:0.3);

  }, "16n");
}

// ===============================
// 7. センサー許可関数（iOS/Android対応）
// ===============================
async function requestMotionPermission() {
  // iOS 13+ （ユーザー操作時にしか許可できない）
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission === 'granted') {
        if (!motionListenerAttached) {
          window.addEventListener('devicemotion', handleMotion);
          motionListenerAttached = true;
        }
        console.log("DeviceMotion permission granted");
        return true;
      } else {
        console.warn("DeviceMotion permission denied");
        return false;
      }
    } catch (err) {
      console.error("DeviceMotionEvent.requestPermission error:", err);
      return false;
    }
  } else {
    // Android / その他ブラウザ（許可不要）
    if (!motionListenerAttached) {
      window.addEventListener('devicemotion', handleMotion);
      motionListenerAttached = true;
    }
    console.log("devicemotion listener added (no permission required)");
    return true;
  }
}

// ===============================
// 8. 開始ボタン処理（許可関数を使用）
// ===============================
const playBtn = document.getElementById('playBtn');
let isPlaying = false;

playBtn.addEventListener('click', async () => {
  if (!isPlaying) {
    // 1) センサー許可（iOSならここでプロンプトが出る）
    const sensorGranted = await requestMotionPermission();
    if (!sensorGranted) {
      // センサーが無い or 拒否された場合、ユーザに知らせつつマウスフォールバックは有効のまま動作
      alert("加速度センサーの許可が必要です（iOSでは必須）。許可しない場合はマウスによる代替動作になります。");
    }

    // 2) Audio を開始（ユーザー操作内で呼ぶ）
    try {
      await Tone.start();
    } catch (e) {
      console.error("Tone.start() error:", e);
    }

    // 3) 音楽セットアップと開始
    setupMusic();
    Tone.Transport.start();

    playBtn.innerText = "STOP";
    playBtn.style.background = "#ff0099";
    isPlaying = true;
  } else {
    // 停止処理
    Tone.Transport.stop();
    // Tone.Transport.cancel(); // スケジュールは残しておきたい場合はコメントアウト
    if (motionListenerAttached) {
      window.removeEventListener('devicemotion', handleMotion);
      motionListenerAttached = false;
    }
    playBtn.innerText = "START";
    playBtn.style.background = "#00d2ff";
    sensorVariance = 0;
    smoothedVariance = 0;
    isPlaying = false;
  }
});
