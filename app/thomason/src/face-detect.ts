import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

export type NormalizedBox = {
  x: number
  y: number
  w: number
  h: number
}

let detectorPromise: Promise<FaceDetector | null> | null = null

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'

async function getDetector(): Promise<FaceDetector | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT)
        try {
          return await FaceDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: 'GPU',
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.5,
          })
        } catch {
          return await FaceDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: 'CPU',
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.5,
          })
        }
      } catch (err) {
        console.warn('Face detector unavailable', err)
        return null
      }
    })()
  }
  return detectorPromise
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for face detection'))
    img.src = src
  })
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Detect faces and return normalized boxes in [0,1]. Empty if none / detector fails. */
export async function detectFaceBoxes(file: Blob): Promise<NormalizedBox[]> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const [detector, img] = await Promise.all([getDetector(), loadImageElement(objectUrl)])
    if (!detector || img.naturalWidth <= 0 || img.naturalHeight <= 0) return []

    const result = detector.detect(img)
    const width = img.naturalWidth
    const height = img.naturalHeight
    const boxes: NormalizedBox[] = []

    for (const detection of result.detections ?? []) {
      const box = detection.boundingBox
      if (!box) continue
      const x = clamp01(box.originX / width)
      const y = clamp01(box.originY / height)
      const w = clamp01(box.width / width)
      const h = clamp01(box.height / height)
      if (w < 0.01 || h < 0.01) continue
      const maxW = Math.max(0.01, 1 - x)
      const maxH = Math.max(0.01, 1 - y)
      boxes.push({
        x,
        y,
        w: Math.min(w, maxW),
        h: Math.min(h, maxH),
      })
    }
    return boxes
  } catch (err) {
    console.warn('Face detection failed', err)
    return []
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
