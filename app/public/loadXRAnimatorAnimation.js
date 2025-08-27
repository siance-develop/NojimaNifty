import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { xrAnimatorVRMRigMap } from './xrAnimatorVRMRigMap.js';

/**
 * XR Animator のアニメーション(glb)を読み込み、VRM向けに変換して返す
 * @param {string} url アニメーションデータのURL
 * @param {VRM} vrm ターゲットのVRM
 * @returns {Promise<THREE.AnimationClip>} 変換されたAnimationClip
 */
export async function loadXRAnimatorAnimation(url, vrm) {
    const loader = new GLTFLoader();
    const sourceGltf = await loader.loadAsync(url);

    const clip = sourceGltf.animations[0];
    if (!clip) {
        console.error(`アニメーションクリップがglbファイル内(${url})に見つかりません。`);
        return null;
    }

    const tracks = [];

    // ヒップの高さを基準にアニメーション全体のY位置を補正する
    const sourceHips = sourceGltf.scene.getObjectByName('J_Bip_C_Hips'); // ★ 正しいボーン名に修正
    if (!sourceHips) {
        console.error('ソースアニメーションに "J_Bip_C_Hips" ボーンが見つかりません。ボーン名を確認してください。');
        return null;
    }

    // VRMのヒップボーンのワールド座標を取得
    const vrmHipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
    if (!vrmHipsNode) {
        console.error('VRMモデルに "hips" ボーンが見つかりません。');
        return null;
    }
    const vrmHipsHeight = vrmHipsNode.getWorldPosition(new THREE.Vector3()).y;
    
    // ソースのヒップの初期位置を取得。アニメーションの最初のフレームの値を使います。
    // Hipsボーンの位置トラックを探す
    const sourceHipsPositionTrack = clip.tracks.find(
        (track) => track.name === 'J_Bip_C_Hips.position'
    );
    if (!sourceHipsPositionTrack) {
        console.error('ソースアニメーションに "J_Bip_C_Hips.position" のトラックが見つかりません。');
        // 位置トラックがなくても処理を続ける場合もあるが、一旦エラーとして返す
        return null; 
    }
    const sourceHipsInitialY = sourceHipsPositionTrack.values[1]; // Y座標は2番目の値 (index 1)
    const scale = vrmHipsHeight / sourceHipsInitialY;


    clip.tracks.forEach((track) => {
        const trackSplitted = track.name.split('.');
        const sourceBoneName = trackSplitted[0];
        const propertyName = trackSplitted[1];

        const vrmBoneName = xrAnimatorVRMRigMap[sourceBoneName];
        if (vrmBoneName) {
            const vrmNodeName = vrm.humanoid.getNormalizedBoneNode(vrmBoneName)?.name;
            if (vrmNodeName) {
                if (track instanceof THREE.QuaternionKeyframeTrack) {
                    tracks.push(new THREE.QuaternionKeyframeTrack(
                        `${vrmNodeName}.${propertyName}`,
                        track.times,
                        track.values
                    ));
                }
                else if (track instanceof THREE.VectorKeyframeTrack && vrmBoneName === 'hips') {
                    const value = track.values.map((v, i) => {
                        // Y座標(i % 3 === 1)のみスケールを適用し、X,Zはそのまま
                        return i % 3 === 1 ? v * scale : v;
                    });
                    tracks.push(new THREE.VectorKeyframeTrack(
                        `${vrmNodeName}.${propertyName}`,
                        track.times,
                        value
                    ));
                }
            }
        }
    });

    return new THREE.AnimationClip('XRAnimatorClip', clip.duration, tracks);
}