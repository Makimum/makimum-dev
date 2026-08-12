import * as THREE from 'three'
import { PALETTE } from '../constants'

/**
 * Фабрика материалов. Каждый материал создаётся ровно один раз и переиспользуется —
 * это и экономия драуколлов, и гарантия, что два предмета «одного» цвета
 * действительно одного цвета.
 *
 * Спайк рендерит в MeshStandardMaterial с реалтайм-светом, чтобы сразу видеть форму.
 * Когда заведётся запекание, `surface()` начнёт отдавать MeshBasicMaterial
 * с лайтмапом — как в референсе. Точка подмены одна, здесь.
 */

const cache = new Map<string, THREE.Material>()

type SurfaceKind = 'matte' | 'satin' | 'gloss' | 'metal'

const KIND: Record<SurfaceKind, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.95, metalness: 0 }, // штукатурка, ткань, бумага
  satin: { roughness: 0.55, metalness: 0 }, // крашеный металл, ЛДСП, пластик
  gloss: { roughness: 0.25, metalness: 0 }, // лак, эмаль
  metal: { roughness: 0.35, metalness: 0.9 }, // хром, алюминий
}

/** Единственный способ получить материал в этом проекте. */
export function surface(color: number, kind: SurfaceKind = 'satin'): THREE.Material {
  const key = `${color}:${kind}`
  const hit = cache.get(key)
  if (hit) return hit

  const mat = new THREE.MeshStandardMaterial({
    color,
    ...KIND[kind],
  })
  cache.set(key, mat)
  return mat
}

/** Абажур: двусторонний, потому что виден изнутри раструба.
 *  Эмиссии НЕТ — лампа выключена как источник целиком. */
export function shadeMaterial(): THREE.Material {
  const key = 'shade'
  const hit = cache.get(key)
  if (hit) return hit

  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.lampShade,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  cache.set(key, mat)
  return mat
}

export function disposeAll() {
  for (const m of cache.values()) m.dispose()
  cache.clear()
}
