// =================================================================================
// 外部ライブラリの読み込み (インポート)
// =================================================================================
import * as THREE from 'three'; // 3Dグラフィックスの基本ライブラリ
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; // GLTF/GLB形式(VRMのベース)のモデルを読み込むためのローダー
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // マウスで3Dモデルを回転・ズーム・パンするための操作コントローラー
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'; // VRMモデルを読み込み、操作するためのプラグイン
import { loadMixamoAnimation } from './loadMixamoAnimation.js'; // MixamoのアニメーションをVRM用に変換するカスタム関数
import { loadXRAnimatorAnimation } from './loadXRAnimatorAnimation.js'; // XR Animator用のアニメーション変換関数

// =================================================================================
// アクション設定
// =================================================================================
// ボタンのアクション（はい・いいえ）に対応する設定です。
// アニメーション、音声、表情のファイルパスや名前をここで一元管理します。
const ACTION_CONFIG = {
    idle: {
        animationPath: 'animations/idle.fbx',
        soundPath: 'sounds/saple-001.wav', // 例: 導入の音声
        expression: 'happy'
    },
    yes: {
        animationPath: 'animations/motion_20second.glb', // 「はい」の時に再生するアニメーションファイル
        soundPath: 'sounds/saple-001.wav',             // 「はい」の時に再生する音声ファイル
        expression: 'relaxed',                     // 「はい」の時に適用する表情名
    },
    no: {
        animationPath: 'animations/Bow.fbx',     // 「いいえ」の時に再生するアニメーションファイル
        soundPath: 'sounds/saple-001.wav',              // 「いいえ」の時に再生する音声ファイル
        expression: 'sad',                     // 「いいえ」の時に適用する表情名
    },
};

// =================================================================================
// VRMビューアのメインクラス
// =================================================================================
// VRMの表示と操作に関するすべての機能をまとめたクラスです。
class VRMViewer {
    // -----------------------------------------------------------------------------
    // コンストラクタ: クラスが作成されたときに最初に実行される処理
    // -----------------------------------------------------------------------------
    constructor() {
        // --- 3Dシーンの基本設定 ---
        this.renderer = new THREE.WebGLRenderer({ antialias: true }); // 3Dを描画するレンダラーを作成
        this.renderer.setSize(window.innerWidth, window.innerHeight);   // レンダラーのサイズをウィンドウに合わせる
        this.renderer.setPixelRatio(window.devicePixelRatio);           // デバイスのピクセル比に合わせて解像度を調整
        //document.body.appendChild(this.renderer.domElement);            // 作成したレンダラーをHTMLに追加
        const mount = document.getElementById('app') || document.body;
        mount.appendChild(this.renderer.domElement);

        this.camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 20.0); // 3D空間を写すカメラを作成
        this.camera.position.set(0.0, 1.0, 5.0); // カメラの位置を設定

        this.scene = new THREE.Scene(); // 3Dオブジェクトを配置する空間（シーン）を作成

        this.controls = new OrbitControls(this.camera, this.renderer.domElement); // マウス操作を有効化
        this.controls.screenSpacePanning = true; // 操作方法をより直感的に
        this.controls.target.set(0.0, 1.0, 0.0); // カメラの注視点をモデルの胸あたりに設定
        this.controls.update();

        this.listener = new THREE.AudioListener(); // 3D空間内の音を聴くためのリスナーを作成
        this.camera.add(this.listener); // リスナーをカメラに追従させる

        const light = new THREE.DirectionalLight(0xffffff, Math.PI); // 平行光源（太陽光のような光）を作成
        light.position.set(1.0, 1.0, 1.0).normalize(); // 光の向きを設定
        this.scene.add(light); // シーンにライトを追加

        const textureLoader = new THREE.TextureLoader(); // 画像を読み込むためのローダー
        textureLoader.load('image/background.jpg', (texture) => {
            this.scene.background = texture; // 読み込んだ画像をシーンの背景に設定
        });

        // --- データ管理用のプロパティ ---
        // アプリケーション全体で使う変数（状態）を初期化します。
        this.clock = new THREE.Clock(); // 時間を管理するための時計
        this.vrm = null;                // 読み込んだVRMモデルデータ
        this.mixer = null;              // アニメーションを再生・管理するミキサー
        this.animationActions = {};     // アニメーションの再生アクションを保持するオブジェクト
        this.currentAction = null;      // 現在再生中のアクション
        this.sounds = {};               // 読み込んだ音声データを保持するオブジェクト
        this.expressionTargets = { happy: 0.0, angry: 0.0, sad: 0.0, relaxed: 0.0 }; // 表情の目標値（0.0:無表情, 1.0:最大）
        this.blinkState = { time: 0.0, nextTime: 3.0, isBlinking: false, progress: 0.0, duration: 0.2 }; // 自動まばたきの状態管理
        this.audioAnalysers = {};       // 音声分析器（リップシンク用）
        this.currentAnalyser = null;    // 現在使用中の音声分析器
        this.currentSound = null;       // 現在再生中の音声

        // --- ランダムリップシンク用のプロパティ --- 
        // それぞれの口の形の目標値を管理するオブジェクト
        this.lipShapeTargets = { aa: 1.0, ih: 0.0, ou: 0.0, ee: 0.0, oh: 0.0 };
        // 口の形を次に変えるまでの時間（タイマー）
        this.mouthShapeChangeTimer = 0.0;

        // 口の形の出現確率の重み 
        this.lipShapeWeights = {
            aa: 3,
            ih: 0.5,
            ou: 1,
            ee: 2,
            oh: 2,
        };

        // --- UI要素とイベントリスナー ---
        //this.yesButton = document.getElementById('yesButton'); // HTMLの「はい」ボタンを取得
        //this.noButton = document.getElementById('noButton');   // HTMLの「いいえ」ボタンを取得

        window.addEventListener('resize', this.onWindowResize.bind(this)); // ウィンドウのリサイズに対応
    }

    // -----------------------------------------------------------------------------
    // 初期化処理
    // -----------------------------------------------------------------------------
    async init() {
        //this.yesButton.disabled = true; // 読み込み中はボタンを無効化
        //this.noButton.disabled = true;
        try {
            await this.loadAssets();          // 必要なファイルをすべて読み込む
            this.setupEventListeners();     // ボタンのクリックイベントを設定
            this.startAnimationLoop();      // 描画ループを開始
            //this.yesButton.disabled = false;  // 読み込み完了後、ボタンを有効化
            //this.noButton.disabled = false;
            console.log('VRMの準備が完了しました。');
        } catch (error) {
            console.error('初期化中にエラーが発生しました:', error);
        }
    }

    // -----------------------------------------------------------------------------
    // アセット（資源）の読み込み
    // -----------------------------------------------------------------------------
    async loadAssets() {
        const gltfLoader = new GLTFLoader();
        gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
        const audioLoader = new THREE.AudioLoader();
        const modelUrl = 'avatar.vrm';

        const gltf = await gltfLoader.loadAsync(modelUrl);

        this.vrm = gltf.userData.vrm;
        this.scene.add(this.vrm.scene);
        VRMUtils.rotateVRM0(this.vrm);
        this.vrm.scene.traverse((obj) => { obj.frustumCulled = false; });

        // カメラ調整（ズームアップ）
        this.camera.fov = 17;
        this.camera.updateProjectionMatrix();
        this.controls.target.set(0.0, 1.3, 0.0);
        this.controls.update();
        // ★ ここまで

        const idleClip = await loadMixamoAnimation('animations/idle.fbx', this.vrm);

        this.mixer = new THREE.AnimationMixer(this.vrm.scene);
        this.mixer.addEventListener('finished', this.onAnimationFinished.bind(this));
        this.animationActions.idle = this.mixer.clipAction(idleClip).play();
        this.currentAction = this.animationActions.idle;

        console.log('各アクションのアセットを読み込みます...');
        const setupAnalyser = (sound) => new THREE.AudioAnalyser(sound, 32);

        for (const [actionName, config] of Object.entries(ACTION_CONFIG)) {
            try {
                console.log(`- ${actionName} を読み込み中...`);

                const animationLoader = config.animationPath.endsWith('.glb')
                    ? loadXRAnimatorAnimation
                    : loadMixamoAnimation;

                const [clip, soundBuffer] = await Promise.all([
                    animationLoader(config.animationPath, this.vrm),
                    audioLoader.loadAsync(config.soundPath),
                ]);

                // ★ 修正: ここでループ設定をしない
                this.animationActions[actionName] = this.mixer.clipAction(clip);
                this.animationActions[actionName].clampWhenFinished = true;

                this.sounds[actionName] = new THREE.Audio(this.listener);
                this.sounds[actionName].setBuffer(soundBuffer);
                this.audioAnalysers[actionName] = setupAnalyser(this.sounds[actionName]);

                console.log(`- ${actionName} の読み込み完了`);

            } catch (error) {
                console.error(`${actionName}のアセット読み込み中にエラーが発生しました:`, error);
            }
        }
    }

    // -----------------------------------------------------------------------------
    // イベントリスナーの設定
    // -----------------------------------------------------------------------------
    setupEventListeners() {
        //this.yesButton.addEventListener('click', () => this.playAction('yes'));
        //this.noButton.addEventListener('click', () => this.playAction('no'));
    }

    // -----------------------------------------------------------------------------
    // アクションの再生 (★ 全面修正)
    // -----------------------------------------------------------------------------
    playAction(actionName) {
        const config = ACTION_CONFIG[actionName];
        const newAction = this.animationActions[actionName];
        const soundToPlay = this.sounds[actionName];

        if (!config || !newAction) return;

        // 音声とアニメーションの長さを比較し、ループ設定を動的に変更
        if (soundToPlay && soundToPlay.buffer) {
            const animDuration = newAction.getClip().duration;
            const soundDuration = soundToPlay.buffer.duration;

            if (animDuration < soundDuration) {
                newAction.setLoop(THREE.LoopRepeat);
            } else {
                newAction.setLoop(THREE.LoopOnce);
            }
        } else {
            newAction.setLoop(THREE.LoopOnce);
        }

        // 表情と音声の処理を先に実行
        this.setExpression(config.expression);
        if (soundToPlay) {
            Object.values(this.sounds).forEach(s => {
                if (s.isPlaying) {
                    s.stop();
                }
                s.onEnded = null;
            });

            soundToPlay.onEnded = () => {
                if (this.currentAction === newAction) {
                    this.returnToIdle(newAction); // returnToIdleはご自身の定義した関数を想定
                }
                soundToPlay.onEnded = null;
            };
            soundToPlay.play();
            this.currentSound = soundToPlay;
            this.currentAnalyser = this.audioAnalysers[actionName] || null;
        }

        // --- アニメーション切り替え処理 ---
        if (this.currentAction === newAction) {
            // ★★★【同じアクションの場合】何もしない ★★★
            // アニメーションをリセットせず、継続させるため、このブロックは空になります。

        } else {
            // 【違うアクションの場合】フェードで滑らかに切り替える
            const oldAction = this.currentAction;
            if (oldAction) {
                oldAction.fadeOut(0.3);
            }
            newAction.reset().fadeIn(0.3).play();
            this.currentAction = newAction;
        }
    }

    // -----------------------------------------------------------------------------
    // アイドル状態への復帰
    // -----------------------------------------------------------------------------
    returnToIdle(actionToStop) {
        if (!actionToStop || actionToStop === this.animationActions.idle) {
            return;
        }

        const idleAction = this.animationActions.idle;

        actionToStop.fadeOut(0.5);
        idleAction.reset().fadeIn(0.5).play();

        this.currentAction = idleAction;
        this.setExpression(null);
    }

    // -----------------------------------------------------------------------------
    // アニメーション終了時の処理
    // -----------------------------------------------------------------------------
    onAnimationFinished(event) {
        this.returnToIdle(event.action);
    }

    // -----------------------------------------------------------------------------
    // 表情の設定
    // -----------------------------------------------------------------------------
    setExpression(targetExpression) {
        Object.keys(this.expressionTargets).forEach(name => {
            this.expressionTargets[name] = (name === targetExpression) ? 1.0 : 0.0;
        });
    }

    // -----------------------------------------------------------------------------
    // アニメーションループの開始
    // -----------------------------------------------------------------------------
    startAnimationLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            const deltaTime = this.clock.getDelta();

            if (this.mixer) this.mixer.update(deltaTime);
            if (this.vrm) {
                this.updateVRMFeatures(deltaTime);
                this.vrm.update(deltaTime);
            }
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }

    // -----------------------------------------------------------------------------
    // VRMの機能更新
    // -----------------------------------------------------------------------------
    updateVRMFeatures(deltaTime) {
        const blink = this.blinkState;

        if (this.expressionTargets.happy <= 0) {
            blink.time += deltaTime;
            if (blink.time > blink.nextTime && !blink.isBlinking) {
                blink.isBlinking = true;
                blink.progress = 0.0;
                blink.time = 0.0;
                blink.nextTime = Math.random() * 8.0 + 2.0;
            }
            if (blink.isBlinking) {
                blink.progress += deltaTime / blink.duration;
                const blinkValue = Math.sin(blink.progress * Math.PI);
                this.vrm.expressionManager.setValue('blink', blinkValue);
                if (blink.progress >= 1.0) {
                    blink.isBlinking = false;
                    this.vrm.expressionManager.setValue('blink', 0.0);
                }
            }
        } else {
            blink.isBlinking = false;
            blink.time = 0.0;
            this.vrm.expressionManager.setValue('blink', 0.0);
        }

        for (const name in this.expressionTargets) {
            const currentValue = this.vrm.expressionManager.getValue(name);
            const targetValue = this.expressionTargets[name];
            const interpolatedValue = THREE.MathUtils.lerp(currentValue, targetValue, 0.1);
            this.vrm.expressionManager.setValue(name, interpolatedValue);
        }

        this.updateLipSync(deltaTime);
    }

    // -----------------------------------------------------------------------------
    // リップシンクの更新
    // -----------------------------------------------------------------------------
    updateLipSync(deltaTime) {
        if (!this.vrm || !this.vrm.expressionManager) return;
        const expressionManager = this.vrm.expressionManager;

        this.mouthShapeChangeTimer -= deltaTime;
        if (this.mouthShapeChangeTimer < 0) {
            const weights = this.lipShapeWeights;
            const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
            let randomValue = Math.random() * totalWeight;

            let nextShape = '';
            for (const shape in weights) {
                randomValue -= weights[shape];
                if (randomValue <= 0) {
                    nextShape = shape;
                    break;
                }
            }

            if (nextShape) {
                for (const shape in this.lipShapeTargets) {
                    this.lipShapeTargets[shape] = (shape === nextShape) ? 1.0 : 0.0;
                }
            }

            this.mouthShapeChangeTimer = Math.random() * 0.12 + 0.08;
        }

        let lipSyncValue = 0.0;
        if (this.currentAnalyser) {
            const average = this.currentAnalyser.getAverageFrequency();
            lipSyncValue = Math.min(average / 200, 1.0);
        }

        if (this.currentSound && !this.currentSound.isPlaying) {
            this.currentSound = null;
            this.currentAnalyser = null;
        }

        for (const shape in this.lipShapeTargets) {
            const currentValue = expressionManager.getValue(shape) || 0;
            const finalTargetValue = this.lipShapeTargets[shape] * lipSyncValue;
            const interpolatedValue = THREE.MathUtils.lerp(currentValue, finalTargetValue, 0.2);
            expressionManager.setValue(shape, interpolatedValue);
        }
    }

    // -----------------------------------------------------------------------------
    // ウィンドウリサイズ処理
    // -----------------------------------------------------------------------------
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// =================================================================================
// アプリケーションの実行
// =================================================================================
const viewer = new VRMViewer();
window.viewer = viewer;   // ← HTMLのフロー制御から playAction を呼ぶために公開
viewer.init();


// 初期モーダル処理
const modal = document.getElementById('start-modal');
const startBtn = document.getElementById('startButton');

startBtn.addEventListener('click', () => {
    modal.classList.remove('active');   // モーダルを閉じる
    showPage('intro-video');                  // 最初のページを表示
});



/**
 * グローバルに選択状態を保持（送信や遷移で使える）
 * 例）window.choiceState.mail_optin === "yes"
 */
window.choiceState = window.choiceState || {};

(function () {


    // 分岐式：.choice-btn に data-next-page があれば、同一ページ内の .btn.next に反映
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.choice-btn');
        if (!btn) return;

        const page = btn.closest('.page');
        if (!page) return;

        const group = page.dataset.choiceGroup || page.id || 'default';
        const buttons = page.querySelectorAll('.choice-btn');

        // すべて解除
        buttons.forEach(b => {
            b.classList.remove('is-selected');
            b.setAttribute('aria-pressed', 'false');
        });

        // 選択付与
        btn.classList.add('is-selected');
        btn.setAttribute('aria-pressed', 'true');

        // 値の保存（グローバル & hidden 連携）
        window.choiceState = window.choiceState || {};
        const value = btn.dataset.value ?? btn.textContent.trim();
        window.choiceState[group] = value;

        const hidden = page.querySelector('input[type="hidden"][name="' + group + '"]');
        if (hidden) hidden.value = value;

        // ★ 次へボタン取得（このページにあるやつ）
        const nextBtn = page.querySelector('.btn.next');
        if (nextBtn) {
            // data-next-page があれば上書き、無ければ既定値(data-next)を維持
            const nextPageId = btn.dataset.nextPage;
            if (nextPageId) nextBtn.dataset.next = nextPageId;
            // ★ ここは「常に」表示する（is-hiddenを外す）
            nextBtn.classList.remove('is-hidden');
        }
    });


    // ページ復元用（戻ってきた時に選択を再反映したい場合）
    window.applyChoiceSelection = function (pageEl) {
        const page = typeof pageEl === 'string' ? document.querySelector(pageEl) : pageEl;
        if (!page) return;
        const group = page.dataset.choiceGroup || page.id || 'default';
        const saved = window.choiceState[group];
        if (!saved) return;

        const target = page.querySelector('.choice-btn[data-value="' + saved + '"]');
        if (target) target.click(); // clickで一括反映（class/hidden/次へ表示）
    };




    function clearBubbles(scope = document) {
        scope.querySelectorAll('.popup-bubble').forEach(b => b.remove());
    }
    function toHtml(text) { return text ? text.replace(/\r?\n/g, '<br>') : ''; }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.choice-btn');
        if (!btn) return;

        const root = btn.closest('.data-bubble-root');
        if (!root) return;

        clearBubbles(document);

        const bubble = document.createElement('div');
        bubble.className = 'popup-bubble';
        const raw = btn.dataset.popupText || '';
        const normalized = raw.replace(/&#10;/g, '\n');
        bubble.innerHTML = `<div>${toHtml(normalized)}</div>`;
        root.appendChild(bubble);

        // 三角の位置を計算してセット
        const btnRect = btn.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        const arrowX = btnRect.left + btnRect.width / 2 - rootRect.left; // ボタン中央
        const arrow = document.createElement('style');
        arrow.textContent = `
      .data-bubble-root .popup-bubble::after {
        left:${arrowX}px;
        transform:translateX(-50%);
      }
      .data-bubble-root .popup-bubble::before {
        left:${arrowX}px;
        transform:translateX(-50%);
      }
            `;
        document.head.appendChild(arrow);

        // hiddenや次へボタン制御
        const page = btn.closest('.page');
        page?.querySelector('.btn.next')?.classList.remove('is-hidden');
        const hiddenInput = page?.querySelector('input[name="tsunagi_ship_to"]');
        if (hiddenInput) hiddenInput.value = btn.dataset.value || '';
    });

})();

(() => {
    const page = document.getElementById('page64');
    if (!page) return;

    const agree = page.querySelector('#agree');
    const next = page.querySelector('.btn.next');
    const hidden = page.querySelector('input[name="consent_agree"]');

    function update() {
        if (agree.checked) {
            next.classList.remove('is-hidden');
            if (hidden) hidden.value = 'true';
        } else {
            next.classList.add('is-hidden');
            if (hidden) hidden.value = 'false';
        }
    }
    agree.addEventListener('change', update);
    update(); // 初期
})();

(() => {
    const page = document.getElementById('payer-signature');
    if (!page) return;

    const canvas = page.querySelector('#signCanvas');
    const next = page.querySelector('.btn.next');
    const undo = page.querySelector('#undoBtn');
    const clear = page.querySelector('#clearBtn');
    const hidden = page.querySelector('input[name="payer_signature_png"]');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let drawing = false;
    let strokes = [];
    let current = [];

    // 計測キャッシュ
    let dpr = 1, rect = null, bL = 0, bT = 0, cntW = 0, cntH = 0, scaleX = 1, scaleY = 1;

    const isVisible = el => !!(el.offsetParent || el.getClientRects().length);

    /** 枠線を含むrectから、内容領域（content box）の幅/高を算出してからDPRを掛ける */
    function resizeCanvasSafe() {
        if (!isVisible(page)) return;

        rect = canvas.getBoundingClientRect();               // ボーダー込み（変形・ズーム反映）
        const cs = getComputedStyle(canvas);
        bL = parseFloat(cs.borderLeftWidth) || 0;
        const bR = parseFloat(cs.borderRightWidth) || 0;
        bT = parseFloat(cs.borderTopWidth) || 0;
        const bB = parseFloat(cs.borderBottomWidth) || 0;

        // content領域のCSSサイズ（＝実際に描ける領域）
        cntW = Math.max(1, rect.width - bL - bR);
        cntH = Math.max(1, rect.height - bT - bB);

        dpr = Math.max(1, window.devicePixelRatio || 1);

        // バッキングストアは content サイズ×DPR
        canvas.width = Math.round(cntW * dpr);
        canvas.height = Math.round(cntH * dpr);

        // 変換行列は常に単位（スケールは自分で掛ける）
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // CSS→実ピクセルの倍率
        scaleX = canvas.width / cntW;
        scaleY = canvas.height / cntH;

        redraw();
    }

    function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3 * dpr;      // 見た目の太さを維持
        ctx.strokeStyle = '#111';

        for (const path of strokes) {
            if (path.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(path[0].x, path[0].y);
            for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
            ctx.stroke();
        }
    }

    /** ポインタ座標（CSSピクセル）→キャンバス実ピクセルへ
     *  左上基準を rect.left/top + borderLeft/top に合わせるのがミソ
     */
    function pointerToCanvas(e) {
        const t = (e.touches ? e.touches[0] : e);
        const xCss = (t.clientX - (rect.left + bL));
        const yCss = (t.clientY - (rect.top + bT));
        const x = Math.max(0, Math.min(cntW, xCss)) * scaleX;
        const y = Math.max(0, Math.min(cntH, yCss)) * scaleY;
        return { x, y };
    }

    function start(e) { drawing = true; current = [pointerToCanvas(e)]; strokes.push(current); redraw(); e.preventDefault(); updateButtons(); }
    function move(e) { if (!drawing) return; current.push(pointerToCanvas(e)); redraw(); e.preventDefault(); }
    function end() { drawing = false; if (current.length <= 1) strokes.pop(); current = []; updateButtons(); }

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    undo?.addEventListener('click', () => { strokes.pop(); redraw(); updateButtons(); });
    clear?.addEventListener('click', () => { strokes = []; redraw(); updateButtons(); });

    next.addEventListener('click', (e) => {
        if (next.classList.contains('is-disabled')) { e.preventDefault(); return; }
        const dataUrl = canvas.toDataURL('image/png');
        if (hidden) hidden.value = dataUrl;
        window.formData = Object.assign(window.formData || {}, { payer_signature: dataUrl });
    });

    function updateButtons() {
        const hasInk = strokes.length > 0;
        next.classList.toggle('is-disabled', !hasInk);
        next.setAttribute('aria-disabled', hasInk ? 'false' : 'true');
    }

    // 可視化・ズーム・スクロールに反応して再計測
    const mo = new MutationObserver(resizeCanvasSafe);
    mo.observe(page, { attributes: true, attributeFilter: ['aria-hidden', 'class', 'style'] });
    window.addEventListener('resize', resizeCanvasSafe);
    if (window.visualViewport) {
        visualViewport.addEventListener('resize', resizeCanvasSafe);
        visualViewport.addEventListener('scroll', resizeCanvasSafe);
    }
    // 初回（描画領域が確定した後）
    setTimeout(resizeCanvasSafe, 0);
})();



//吹き出し表示制御
document.querySelectorAll('.page[data-show-staff-bubble!="true"] .staff-bubble')
    .forEach(el => el.style.display = 'none');

