export async function awaitFirstImage(container: Element): Promise<void> {
  const firstImg = container.querySelector<HTMLImageElement>('img')
  if (!firstImg || (firstImg.complete && firstImg.naturalWidth > 0)) return
  await new Promise<void>((resolve) => {
    firstImg.addEventListener('load', () => resolve(), { once: true })
    firstImg.addEventListener('error', () => resolve(), { once: true })
  })
}

export function setupImageMeasuring(container: Element, measure: () => void): void {
  container.querySelectorAll('img').forEach((img) => {
    img.addEventListener('load', () => measure())
  })
}

export function setupHiResUpgrades(container: Element, upgradeMap: Map<string, string[]>): void {
  container.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const candidates = upgradeMap.get(img.src)
    if (!candidates?.length) return
    function tryUpgrade(idx: number): void {
      if (idx >= candidates!.length) return
      const bg = new Image()
      bg.onload = () => {
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        if (
          iw > 0 &&
          ih > 0 &&
          bg.naturalWidth > iw &&
          Math.abs(bg.naturalWidth / bg.naturalHeight - iw / ih) < 0.02
        ) {
          img.src = bg.src
        } else {
          tryUpgrade(idx + 1)
        }
      }
      bg.onerror = () => tryUpgrade(idx + 1)
      bg.src = candidates![idx]
    }
    if (img.complete && img.naturalWidth > 0) tryUpgrade(0)
    else img.addEventListener('load', () => tryUpgrade(0), { once: true })
  })
}
