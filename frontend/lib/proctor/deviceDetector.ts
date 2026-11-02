'use client';

import type { FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';

/**
 * The proctor's eyes in the candidate's own browser (Google MediaPipe), so a
 * warning can pop up within about two seconds instead of waiting on a server
 * call. Looks at the webcam several times a second for:
 *   · no face, or more than one face        (Face Landmarker)
 *   · head turned, or eyes off the screen   (head pose + eye blendshapes)
 *   · a phone in view                       (Object Detector, COCO "cell phone")
 *
 * The model and WebAssembly files are served by the app itself from /t/mediapipe
 * (/t/ is the public test-link prefix, so a candidate without an account can
 * load them, and no outside host is needed). Nothing leaves the device from
 * here; the page reports a problem to the server only once it has lasted.
 *
 * Head and eye angles are measured against the candidate's own resting pose,
 * taken over their first couple of seconds, so a laptop camera below the eyes
 * doesn't read as "looking down".
 */

export type DeviceCategory = 'no_face' | 'multiple_faces' | 'phone' | 'looking_away';

export interface DeviceObservation {
    category: DeviceCategory | null;
    /** A short, human sentence for the reviewer's log. */
    observation: string;
    faces: number;
    yaw?: number;
    pitch?: number;
    score?: number;
}

const ASSET_ROOT = '/t/mediapipe';

// Thresholds, relative to the candidate's resting pose. Tuned to catch a clear look away,
// not normal reading; the 1.5s hold in the page filters out glances and blinks.
const HEAD_YAW_DEG = 25;
const HEAD_PITCH_DEG = 20;
const EYES_SIDEWAYS = 0.5;
const EYES_DOWN_EXTRA = 0.35;
const BLINK = 0.5;
const PHONE_SCORE = 0.45;
const CALIBRATION_SAMPLES = 8;

type Blend = Record<string, number>;

export interface DeviceDetector {
    /** Call several times a second with the live <video>. `checkPhone` runs the heavier object model. */
    analyse(video: HTMLVideoElement, checkPhone: boolean): DeviceObservation;
    /**
     * Run both models once on the camera preview and throw the answer away. The first run
     * compiles the GPU code and briefly freezes the page; doing it during setup keeps that
     * hitch off the moment the questions appear. Doesn't touch the resting-pose calibration.
     */
    warmUp(video: HTMLVideoElement): void;
    /** Safe to call more than once. */
    close(): void;
}

/** Loads both models; null when this browser or device can't run them (the server check still runs). */
export async function createDeviceDetector(): Promise<DeviceDetector | null> {
    try {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks(`${ASSET_ROOT}/wasm`);

        // GPU where the browser allows it, else CPU.
        const withDelegate = async <T,>(make: (delegate: 'GPU' | 'CPU') => Promise<T>) => {
            try { return await make('GPU'); } catch { return make('CPU'); }
        };

        const face: FaceLandmarker = await withDelegate((delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${ASSET_ROOT}/models/face_landmarker.task`, delegate },
            runningMode: 'VIDEO',
            numFaces: 3,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
        }));
        const objects: ObjectDetector = await withDelegate((delegate) => vision.ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${ASSET_ROOT}/models/efficientdet_lite0.tflite`, delegate },
            runningMode: 'VIDEO',
            scoreThreshold: PHONE_SCORE,
            categoryAllowlist: ['cell phone'],
            maxResults: 1,
        }));

        let lastTs = 0;
        let closed = false;
        const baseline: { yaw: number; pitch: number; down: number }[] = [];
        let rest = { yaw: 0, pitch: 0, down: 0 };
        let lastPhone: { seen: boolean; score: number } = { seen: false, score: 0 };

        return {
            analyse(video, checkPhone) {
                // MediaPipe needs strictly increasing timestamps per task.
                const ts = Math.max(performance.now(), lastTs + 1);
                lastTs = ts;

                const result = face.detectForVideo(video, ts);
                const faces = result.faceLandmarks?.length || 0;

                if (checkPhone) {
                    const found = objects.detectForVideo(video, ts).detections?.[0]?.categories?.[0];
                    lastPhone = { seen: !!found && found.score >= PHONE_SCORE, score: found?.score || 0 };
                }

                if (faces === 0) return { category: 'no_face', observation: 'No face in front of the camera', faces };
                if (faces > 1) return { category: 'multiple_faces', observation: `${faces} faces in front of the camera`, faces };
                if (lastPhone.seen) {
                    return { category: 'phone', observation: `Phone in view (confidence ${Math.round(lastPhone.score * 100)}%)`, faces, score: lastPhone.score };
                }

                const { yaw, pitch } = headAngles(result.facialTransformationMatrixes?.[0]?.data);
                const blend: Blend = Object.fromEntries((result.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]));
                const avg = (a: string, b: string) => ((blend[a] || 0) + (blend[b] || 0)) / 2;
                const down = avg('eyeLookDownLeft', 'eyeLookDownRight');

                // The first few clean frames set the resting pose.
                if (baseline.length < CALIBRATION_SAMPLES) {
                    baseline.push({ yaw, pitch, down });
                    if (baseline.length === CALIBRATION_SAMPLES) rest = medianPose(baseline);
                    return { category: null, observation: 'Calibrating', faces, yaw, pitch };
                }

                const dYaw = wrapDeg(yaw - rest.yaw);
                const dPitch = wrapDeg(pitch - rest.pitch);
                if (Math.abs(dYaw) > HEAD_YAW_DEG || Math.abs(dPitch) > HEAD_PITCH_DEG) {
                    const where = Math.abs(dYaw) >= Math.abs(dPitch) ? 'to the side' : 'up or down';
                    return { category: 'looking_away', observation: `Head turned ${where} (${Math.round(Math.abs(dYaw))}° side, ${Math.round(Math.abs(dPitch))}° tilt)`, faces, yaw: dYaw, pitch: dPitch };
                }

                if (avg('eyeBlinkLeft', 'eyeBlinkRight') < BLINK) {
                    // Both eyes turned the same way: out on one side and in on the other.
                    const sideways = Math.max(avg('eyeLookOutLeft', 'eyeLookInRight'), avg('eyeLookInLeft', 'eyeLookOutRight'));
                    if (sideways > EYES_SIDEWAYS) return { category: 'looking_away', observation: 'Eyes looking to the side, away from the screen', faces, yaw: dYaw, pitch: dPitch };
                    if (down - rest.down > EYES_DOWN_EXTRA) return { category: 'looking_away', observation: 'Eyes looking down, below the screen', faces, yaw: dYaw, pitch: dPitch };
                }

                return { category: null, observation: 'On screen', faces, yaw: dYaw, pitch: dPitch };
            },
            warmUp(video) {
                if (closed || video.readyState < 2) return;
                const ts = Math.max(performance.now(), lastTs + 1);
                lastTs = ts;
                try {
                    face.detectForVideo(video, ts);
                    objects.detectForVideo(video, ts);
                } catch { /* a failed warm-up only means the first real check is the slow one */ }
            },
            close() {
                if (closed) return;
                closed = true;
                face.close();
                objects.close();
            },
        };
    } catch (err) {
        console.warn('[proctor] on-device detector unavailable:', err instanceof Error ? err.message : err);
        return null;
    }
}

/** Yaw (left/right) and pitch (up/down) in degrees from MediaPipe's column-major 4×4 face transform. */
function headAngles(m: number[] | undefined) {
    if (!m || m.length < 16) return { yaw: 0, pitch: 0 };
    const deg = (r: number) => (r * 180) / Math.PI;
    const yaw = deg(Math.asin(Math.max(-1, Math.min(1, -m[2]))));
    const pitch = deg(Math.atan2(m[6], m[10]));
    return { yaw, pitch };
}

/** An angle difference folded into -180…180, so 179° vs -179° reads as 2°, not 358°. */
function wrapDeg(d: number) {
    return ((((d + 180) % 360) + 360) % 360) - 180;
}

function medianPose(samples: { yaw: number; pitch: number; down: number }[]) {
    const median = (xs: number[]) => {
        const s = [...xs].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
    };
    return { yaw: median(samples.map((s) => s.yaw)), pitch: median(samples.map((s) => s.pitch)), down: median(samples.map((s) => s.down)) };
}
