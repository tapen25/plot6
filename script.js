// DOM要素の取得
const startButton = document.getElementById('startButton');
const statusDiv = document.getElementById('status');
const cadenceDiv = document.getElementById('cadence');

// オーディオ関連の変数
let audioContext;
const sources = {};
const gains = {};
let currentState = 'a'; // 初期状態は 'a' (静止)

// 歩行判定のロジックに関する定数 (これらの値は実際に試して調整が必要です)
const PEAK_THRESHOLD = 1.8;      // 歩行と判定する加速度の大きさの閾値
const STEP_INTERVAL_MS = 350;    // これより短い間隔のピークは無視する (チャタリング防止)
const HISTORY_SECONDS = 5;       // ケイデンス計算に使う過去のデータ時間 (秒)
const STILL_THRESHOLD = 30;      // これ以下のケイデンスは「静止」とみなす
const WALK_THRESHOLD = 110;      // これ以下のケイデンスは「歩行」、超えたら「速い歩行」

// 歩行判定のための変数
let lastPeakTime = 0;
const stepHistory = [];

// スタートボタンが押された時の処理
startButton.addEventListener('click', init);

async function init() {
    startButton.disabled = true;
    startButton.textContent = '準備中...';

    // 1. オーディオコンテキストの初期化
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // 2. オーディオファイルの読み込みと設定
    try {
        await setupAudio();
    } catch (error) {
        startButton.textContent = 'オーディオ読み込み失敗';
        console.error('Audio loading failed:', error);
        return;
    }

    // 3. センサーへのアクセス許可を要求
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const permissionState = await DeviceMotionEvent.requestPermission();
        if (permissionState === 'granted') {
            window.addEventListener('devicemotion', handleMotion);
            startButton.textContent = '開始しました';
        } else {
            startButton.textContent = 'センサー利用が許可されませんでした';
        }
    } else {
        // iOS 12.2以前やAndroidの場合
        window.addEventListener('devicemotion', handleMotion);
        startButton.textContent = '開始しました';
    }
}

async function setupAudio() {
    const audioFiles = ['sanpo_bass.mp3', 'sanpo_drums.mp3', 'sanpo_other.mp3'];
    const loadPromises = audioFiles.map(async (file) => {
        const key = file.split('.')[0];
        const response = await fetch(file);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Web Audio APIのノードを作成
        sources[key] = audioContext.createBufferSource();
        sources[key].buffer = audioBuffer;
        sources[key].loop = true;

        gains[key] = audioContext.createGain();
        sources[key].connect(gains[key]);
        gains[key].connect(audioContext.destination);
    });

    await Promise.all(loadPromises);

    // 初期音量を設定 ('a'のみ1、他は0)
    gains['sanpo_bass'].gain.value = 1;
    gains['sanpo_drums'].gain.value = 0;
    gains['sanpo_other'].gain.value = 0;

    // 全ての音源を同時に再生開始
    sources['sanpo_bass'].start(0);
    sources['sanpo_drums'].start(0);
    sources['sanpo_other'].start(0);
}

function handleMotion(event) {
    const acc = event.acceleration;
    if (!acc || acc.x === null) return;

    // 加速度の大きさ（マグニチュード）を計算
    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
    const now = Date.now();

    // 歩行のピークを検出
    if (magnitude > PEAK_THRESHOLD && now - lastPeakTime > STEP_INTERVAL_MS) {
        lastPeakTime = now;
        stepHistory.push(now);
    }
    
    // 古い履歴を削除
    while (stepHistory.length > 0 && now - stepHistory[0] > HISTORY_SECONDS * 1000) {
        stepHistory.shift();
    }

    // ケイデンス（1分あたりの歩数）を計算
    const cadence = stepHistory.length * (60000 / (HISTORY_SECONDS * 1000));
    cadenceDiv.textContent = Math.round(cadence);
    
    // 状態を判定してオーディオを更新
    updateAudioState(cadence);
}

function updateAudioState(cadence) {
    let newState;
    if (cadence < STILL_THRESHOLD) {
        newState = 'sanpo_bass';
        statusDiv.textContent = '静止';
    } else if (cadence < WALK_THRESHOLD) {
        newState = 'sanpo_drums';
        statusDiv.textContent = '歩行';
    } else {
        newState = 'sanpo_other';
        statusDiv.textContent = '速い歩行';
    }

    // 状態が変化した場合のみクロスフェードを実行
    if (newState !== currentState) {
        const fadeTime = 2.0; // 2秒かけて滑らかに切り替える
        const now = audioContext.currentTime;
        
        // 現在のトラックの音量を下げる
        gains[currentState].gain.linearRampToValueAtTime(0, now + fadeTime);
        // 新しいトラックの音量を上げる
        gains[newState].gain.linearRampToValueAtTime(1, now + fadeTime);
        
        console.log(`State changed: ${currentState} -> ${newState}`);
        currentState = newState;
    }
}