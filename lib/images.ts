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

function draw(img: HTMLImageElement, maxSide: number, background: string | null = "#ffffff") {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext("2d")!
  if (background) {
    ctx.fillStyle = background // transparent areas become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { canvas, ctx, scaled: scale < 1 }
}

/** True if any pixel is (partly) see-through. */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

/**
 * Small picture for project cards (roughly 20–80 KB). Pictures with see-through parts (like a
 * bead-pattern picture) stay see-through as a PNG; everything else becomes a JPEG.
 */
export async function makeThumbnail(src: string, maxSide = 420): Promise<string> {
  const img = await loadImage(src)
  if (src.startsWith("data:image/png")) {
    const { canvas, ctx } = draw(img, maxSide, null)
    try {
      if (hasTransparency(ctx, canvas.width, canvas.height)) return canvas.toDataURL("image/png")
    } catch { /* can't read pixels: fall through to JPEG */ }
  }
  const { canvas } = draw(img, maxSide)
  return canvas.toDataURL("image/jpeg", 0.75)
}

/**
 * Keeps new uploads to a sensible size: anything bigger than 2400 px on its long side is
 * scaled down (still plenty for reading a pattern). Smaller pictures are kept exactly as they are.
 */
export async function limitPictureSize(src: string, maxSide = 2400): Promise<string> {
  const img = await loadImage(src)
  if (Math.max(img.naturalWidth, img.naturalHeight) <= maxSide) return src
  const png = src.startsWith("data:image/png")
  const { canvas } = draw(img, maxSide, png ? null : "#ffffff") // PNGs keep see-through parts
  return png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92)
}
