import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  cropImageToDataUrl, fileToImage, revokeImageObjectUrl, computeCropRect,
} from '../../lib/image'

/**
 * Modal that lets the user pan + zoom a freshly-picked image into the square
 * crop frame used for the profile photo. The frame is fixed; everything else
 * (pan via drag / arrow keys, zoom via slider / mouse wheel / ± buttons)
 * adjusts the source rectangle that gets written to the canvas. Producing the
 * final data URL is delegated to `cropImageToDataUrl` so the same math is
 * unit-testable from a Node environment.
 *
 * Why a custom cropper instead of a library: the rest of the app keeps a tight
 * dep tree (no Tailwind, no CSS-in-JS, lazy `docx`, etc.), and the cropping
 * needs here are narrow — a square frame, square output, no rotation/skew.
 */
export interface ImageCropperModalProps {
  file: File
  label: string
  /** Output side in pixels (square). Defaults to 600 to match `ImageField`. */
  outputSize?: number
  /** JPEG quality 0..1. Defaults to 0.82. */
  quality?: number
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}

/** CSS-pixel side of the cropping viewport. Keep in sync with the .imgcrop-frame size. */
const VIEWPORT_PX = 320
/** Multiplicative zoom range — 1.0 means "the shorter image edge fills the viewport". */
const MIN_ZOOM = 1
const MAX_ZOOM = 4
/** Keyboard arrow nudge per keypress (CSS pixels). */
const NUDGE_PX = 12

export function ImageCropperModal({
  file, label, outputSize = 600, quality = 0.82, onCancel, onConfirm,
}: ImageCropperModalProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number>(1)
  /** Pan offset of the image inside the viewport, in CSS pixels. (0,0) = centered. */
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; px: number; py: number } | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)

  // ── Decode the picked file into an <Image> we can measure & redraw ────────
  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    fileToImage(file).then(({ image, objectUrl: url }) => {
      if (cancelled) { revokeImageObjectUrl(url); return }
      createdUrl = url
      setImg(image)
      setObjectUrl(url)
    }).catch((e: Error) => {
      if (!cancelled) setDecodeError(e.message)
    })
    return () => {
      cancelled = true
      // If we never set state, the URL has already been revoked by fileToImage's
      // error branch; otherwise the unmount-cleanup below revokes it.
      if (createdUrl) revokeImageObjectUrl(createdUrl)
    }
  }, [file])

  // Belt + braces: revoke any object URL we still hold when the modal unmounts.
  useEffect(() => () => { revokeImageObjectUrl(objectUrl) }, [objectUrl])

  // ── Geometry helpers ──────────────────────────────────────────────────────
  // baseScale = the CSS-pixel scale at zoom 1.0, i.e. how big the image is in the
  // viewport BEFORE the user's zoom slider applies. Picking max(viewport/W,
  // viewport/H) makes the image cover the frame in both axes at zoom 1.
  const baseScale = useMemo(() => {
    if (!img) return 1
    return Math.max(VIEWPORT_PX / img.naturalWidth, VIEWPORT_PX / img.naturalHeight)
  }, [img])

  /** Half the slack between displayed image edge and viewport edge (the pan limit). */
  const panBounds = useMemo(() => {
    if (!img) return { maxX: 0, maxY: 0 }
    const dispW = img.naturalWidth  * baseScale * zoom
    const dispH = img.naturalHeight * baseScale * zoom
    return {
      maxX: Math.max(0, (dispW - VIEWPORT_PX) / 2),
      maxY: Math.max(0, (dispH - VIEWPORT_PX) / 2),
    }
  }, [img, baseScale, zoom])

  // When zoom changes, re-clamp pan so the image still covers the viewport.
  useEffect(() => {
    setPan((p) => clampPan(p, panBounds))
  }, [panBounds])

  // ── Mouse / touch panning ─────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!img) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, px: pan.x, py: pan.y }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const nx = d.px + (e.clientX - d.startX)
    const ny = d.py + (e.clientY - d.startY)
    setPan(clampPan({ x: nx, y: ny }, panBounds))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  // Mouse wheel = zoom (with sensible step). preventDefault stops the page from
  // scrolling while the cursor sits over the frame.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!img) return
    e.preventDefault()
    const step = e.deltaY > 0 ? -0.1 : 0.1
    setZoom((z) => clampZoom(z + step))
  }

  // Keyboard panning when the frame is focused, for accessibility / keyboard-
  // only users. Arrow keys nudge; +/- adjust zoom; r resets.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!img) return
    let handled = true
    switch (e.key) {
      case 'ArrowLeft':  setPan((p) => clampPan({ x: p.x + NUDGE_PX, y: p.y }, panBounds)); break
      case 'ArrowRight': setPan((p) => clampPan({ x: p.x - NUDGE_PX, y: p.y }, panBounds)); break
      case 'ArrowUp':    setPan((p) => clampPan({ x: p.x, y: p.y + NUDGE_PX }, panBounds)); break
      case 'ArrowDown':  setPan((p) => clampPan({ x: p.x, y: p.y - NUDGE_PX }, panBounds)); break
      case '+': case '=': setZoom((z) => clampZoom(z + 0.1)); break
      case '-': case '_': setZoom((z) => clampZoom(z - 0.1)); break
      case 'r': case 'R': reset(); break
      default: handled = false
    }
    if (handled) e.preventDefault()
  }

  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  // ── Apply the crop ────────────────────────────────────────────────────────
  const apply = () => {
    if (!img) return
    setBusy(true)
    try {
      const rect = computeCropRect(img, baseScale, zoom, pan, VIEWPORT_PX)
      // Output square: we cap at the cropped source side so we never upsample
      // when the user picked a small image; the caller's max (typically 600)
      // still applies as an upper bound.
      const out = cropImageToDataUrl(img, rect, { maxDim: outputSize, format: 'jpeg', quality })
      onConfirm(out)
    } catch (e) {
      setDecodeError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Focus the frame on mount so keyboard panning works without an extra click.
  useEffect(() => {
    if (img) frameRef.current?.focus()
  }, [img])

  // ── Render ────────────────────────────────────────────────────────────────
  // The image is anchored at (50%, 50%) of the frame and centred by the
  // leading `translate(-50%, -50%)` (which uses the element's intrinsic
  // box size — naturalWidth × naturalHeight — for the percentage). We
  // then translate by the user's pan and scale by baseScale × zoom. ALL
  // three functions share the default `transform-origin: center`, which
  // is what computeCropRect's math assumes (zoom pivots around the box
  // centre, viewport centre maps to source-pixel naturalW/2 − pan.x/s).
  // The earlier version split centring into the logical `translate`
  // property + a `transform-origin: 0 0`, which put the scale pivot at
  // the top-left and made the visible image drift off-frame, breaking
  // both the pan clamp and the final crop.
  const imgTransform = img
    ? `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${baseScale * zoom})`
    : undefined

  return (
    <div className="imgcrop-backdrop" role="dialog" aria-modal="true" aria-label={`Crop ${label}`}>
      <div className="imgcrop-modal">
        <div className="imgcrop-head">
          <div>
            <div className="imgcrop-title">Crop {label.toLowerCase()}</div>
            <div className="imgcrop-sub">Drag to pan, scroll or use the slider to zoom.</div>
          </div>
          <button type="button" className="imgcrop-x" onClick={onCancel} aria-label="Cancel">
            <X size={18} />
          </button>
        </div>

        {decodeError && (
          <div className="imgcrop-error" role="alert">{decodeError}</div>
        )}

        <div
          ref={frameRef}
          tabIndex={0}
          role="application"
          aria-label="Pan with arrow keys, plus or minus to zoom, R to reset"
          className="imgcrop-frame"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
        >
          {img && objectUrl && (
            <img
              className="imgcrop-img"
              src={objectUrl}
              alt=""
              draggable={false}
              style={{
                width: img.naturalWidth,
                height: img.naturalHeight,
                transform: imgTransform,
              }}
            />
          )}
          {!img && !decodeError && <div className="imgcrop-loading">Loading…</div>}
          {/* The square mask sits above the image — fully transparent in the
              centre, semi-opaque around the edges — so the user sees what
              survives the crop. Pointer events pass through to the image. */}
          <div className="imgcrop-mask" />
          <div className="imgcrop-outline" />
        </div>

        <div className="imgcrop-controls">
          <button
            type="button"
            className="imgcrop-iconbtn"
            onClick={() => setZoom((z) => clampZoom(z - 0.1))}
            disabled={!img || zoom <= MIN_ZOOM}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(clampZoom(parseFloat(e.target.value)))}
            aria-label="Zoom"
            disabled={!img}
          />
          <button
            type="button"
            className="imgcrop-iconbtn"
            onClick={() => setZoom((z) => clampZoom(z + 0.1))}
            disabled={!img || zoom >= MAX_ZOOM}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="imgcrop-iconbtn imgcrop-reset"
            onClick={reset}
            disabled={!img}
            title="Reset (R)"
          >
            <RotateCcw size={13} />
          </button>
        </div>

        <div className="imgcrop-footer">
          <button type="button" className="imgcrop-btn imgcrop-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="imgcrop-btn imgcrop-apply" onClick={apply} disabled={!img || busy}>
            <Check size={14} /> {busy ? 'Saving…' : 'Use this crop'}
          </button>
        </div>
      </div>

      <style>{`
        .imgcrop-backdrop {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(15, 23, 42, .55);
          display: grid; place-items: center;
          padding: 24px;
        }
        .imgcrop-modal {
          width: min(420px, 100%);
          background: var(--paper); border-radius: var(--r-lg);
          box-shadow: var(--shadow-lg); border: 1px solid var(--line);
          display: flex; flex-direction: column;
        }
        .imgcrop-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 10px; padding: 16px 16px 10px;
        }
        .imgcrop-title { font-weight: 600; font-size: 15px; color: var(--ink); }
        .imgcrop-sub   { font-size: 12px; color: var(--ink-soft); margin-top: 2px; }
        .imgcrop-x {
          background: transparent; padding: 4px; border-radius: var(--r-sm);
          color: var(--ink-faint); transition: all .13s;
        }
        .imgcrop-x:hover { background: var(--paper-sunken); color: var(--ink); }
        .imgcrop-error {
          margin: 0 16px 8px;
          padding: 8px 10px; border-radius: var(--r-sm);
          background: #fee2e2; color: #991b1b; font-size: 12.5px;
        }
        .imgcrop-frame {
          position: relative;
          width: ${VIEWPORT_PX}px; height: ${VIEWPORT_PX}px;
          margin: 6px auto 10px;
          overflow: hidden;
          background: #0f172a;
          border-radius: var(--r-sm);
          touch-action: none;
          user-select: none;
          cursor: grab;
          outline: none;
        }
        .imgcrop-frame:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
        .imgcrop-frame:active { cursor: grabbing; }
        .imgcrop-img {
          position: absolute; top: 50%; left: 50%;
          /* No transform-origin override — default is center, which is what
             both the visual layout and computeCropRect assume. The centring
             (-50%, -50%) is part of the same transform chain set inline so
             it shares the centre origin with the pan + scale. */
          pointer-events: none;
        }
        .imgcrop-loading {
          position: absolute; inset: 0; display: grid; place-items: center;
          color: #cbd5e1; font-size: 13px;
        }
        .imgcrop-mask {
          position: absolute; inset: 0; pointer-events: none;
          /* Tiny inner ring (~1px) to keep the outline crisp against the image. */
          box-shadow: inset 0 0 0 9999px rgba(15, 23, 42, .35);
        }
        .imgcrop-outline {
          position: absolute; inset: 0; pointer-events: none;
          border: 1.5px solid rgba(255, 255, 255, .9);
          border-radius: var(--r-sm);
        }
        .imgcrop-controls {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 16px 10px;
        }
        .imgcrop-controls input[type=range] {
          flex: 1; accent-color: var(--accent);
        }
        .imgcrop-iconbtn {
          display: inline-grid; place-items: center;
          width: 28px; height: 28px;
          background: var(--paper-sunken); color: var(--ink);
          border-radius: var(--r-sm); transition: all .13s;
        }
        .imgcrop-iconbtn:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
        .imgcrop-iconbtn:disabled { opacity: .4; cursor: not-allowed; }
        .imgcrop-reset { margin-left: 4px; }
        .imgcrop-footer {
          display: flex; justify-content: flex-end; gap: 8px;
          padding: 10px 16px 14px;
          border-top: 1px solid var(--line);
        }
        .imgcrop-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: var(--r-sm);
          font-size: 13px; font-weight: 600; transition: all .13s;
        }
        .imgcrop-cancel { background: var(--paper-sunken); color: var(--ink); }
        .imgcrop-cancel:hover:not(:disabled) { background: var(--line); }
        .imgcrop-apply { background: var(--accent); color: #fff; }
        .imgcrop-apply:hover:not(:disabled) { background: var(--accent-bright); }
        .imgcrop-apply:disabled, .imgcrop-cancel:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </div>
  )
}

// ─── Pure geometry ──────────────────────────────────────────────────────────

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ZOOM
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

function clampPan(p: { x: number; y: number }, bounds: { maxX: number; maxY: number }): { x: number; y: number } {
  return {
    x: Math.max(-bounds.maxX, Math.min(bounds.maxX, p.x)),
    y: Math.max(-bounds.maxY, Math.min(bounds.maxY, p.y)),
  }
}
