/**
 * Picture helpers (browser only).
 *
 * Project pictures are stored as text (data URLs) in the project table. Loading all of them
 * at once made the project list time out, so the list only loads a small thumbnail and the
 * full picture is fetched when a project is opened.
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Could not open the picture."))
    img.src = src
  })
}

function draw(img: HTMLImageElement, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#ffffff" // transparent areas become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { canvas, scaled: scale < 1 }
}

/** Small JPEG for project cards (roughly 20–80 KB). */
export async function makeThumbnail(src: string, maxSide = 420): Promise<string> {
  const { canvas } = draw(await loadImage(src), maxSide)
  return canvas.toDataURL("image/jpeg", 0.75)
}

/**
 * Keeps new uploads to a sensible size: anything bigger than 2400 px on its long side is
 * scaled down (still plenty for reading a pattern). Smaller pictures are kept exactly as they are.
 */
export async function limitPictureSize(src: string, maxSide = 2400): Promise<string> {
  const img = await loadImage(src)
  if (Math.max(img.naturalWidth, img.naturalHeight) <= maxSide) return src
  const { canvas } = draw(img, maxSide)
  return src.startsWith("data:image/png") ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92)
}
