"""Brand icon helpers — no new runtime dependencies.

Provides SVG path data and colors for common social/link providers and three
rendering surfaces:
  * svg()            — inline SVG string for HTML templates
  * drawing()        — reportlab Drawing for PDF embedding
  * badge_png_path() — PIL-rendered PNG badge path for inline PDF <img> tags
  * declutter()      — strip URL noise to (provider, handle) for display text
"""

from __future__ import annotations

import base64
import html as html_lib
import math
import mimetypes
import os
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[4]
ASSET_DIRS = [
    PROJECT_ROOT / "config" / "assets",
    PROJECT_ROOT / "assets",
]
ASSET_EXTENSIONS = (".svg", ".png", ".jpg", ".jpeg")
ASSET_STEMS: dict[str, tuple[str, ...]] = {
    "github": ("github-icon",),
    "linkedin": ("linkedin-icon",),
    "facebook": ("fb-icon", "facebook-icon"),
}

BRAND_PATHS: dict[str, str] = {
    "github": (
        "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385"
        ".6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042"
        "-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744"
        ".084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835"
        " 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466"
        "-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523"
        ".105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02"
        ".006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653"
        ".24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625"
        "-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286"
        " 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627"
        "-5.373-12-12-12"
    ),
    "linkedin": (
        "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037"
        "-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046"
        "c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286"
        "zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063"
        " 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0"
        " 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24"
        " 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"
    ),
    "facebook": (
        "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388"
        " 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792"
        "-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83"
        "c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385"
        "C19.612 23.027 24 18.062 24 12.073z"
    ),
    # Material Design "public" globe icon — uses only M/c/s/h/v/z (no arcs)
    "website": (
        "M12 2c-5.52 0-10 4.48-10 10s4.48 10 10 10 10-4.48 10-10S17.52 2"
        " 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9"
        " 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v"
        "-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v"
        "-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
    ),
}

BRAND_COLORS: dict[str, str] = {
    "github": "#181717",
    "linkedin": "#0A66C2",
    "facebook": "#1877F2",
    "website": "#5b6270",
}


def svg(provider: str, size: int = 12) -> str:
    """Return an inline SVG string for the given provider. Returns '' for unknown."""
    path = BRAND_PATHS.get(provider, "")
    color = BRAND_COLORS.get(provider, "#000000")
    if not path:
        return ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 24 24" aria-hidden="true" '
        f'style="vertical-align:middle;margin-right:3px;">'
        f'<path d="{path}" fill="{color}"/>'
        f"</svg>"
    )


def asset_path(provider: str, *, raster_only: bool = False) -> Path | None:
    """Return the first matching configured icon asset for provider."""
    provider_key = _normalize_provider(provider)
    stems = ASSET_STEMS.get(provider_key, ())
    if not stems:
        return None

    dirs: list[Path] = []
    env_dir = os.environ.get("RESUME_ASSETS_DIR")
    if env_dir:
        dirs.append(Path(env_dir))
    dirs.extend(ASSET_DIRS)

    extensions = ASSET_EXTENSIONS
    if raster_only:
        extensions = tuple(ext for ext in extensions if ext != ".svg")

    for directory in dirs:
        for stem in stems:
            for ext in extensions:
                candidate = directory / f"{stem}{ext}"
                if candidate.is_file():
                    return candidate
    return None


def html(provider: str, size: int = 12) -> str:
    """Return an HTML icon, preferring user-provided SVG/PNG/JPG assets."""
    asset = asset_path(provider)
    if asset is None:
        return svg(provider, size)

    mime = mimetypes.guess_type(asset.name)[0] or _mime_for_suffix(asset.suffix)
    encoded = base64.b64encode(asset.read_bytes()).decode("ascii")
    alt = html_lib.escape(_normalize_provider(provider), quote=True)
    return (
        f'<img class="brand-icon" src="data:{mime};base64,{encoded}" alt="{alt}" '
        f'width="{size}" height="{size}" aria-hidden="true">'
    )


def drawing(provider: str, size: float = 9):
    """Return a reportlab Drawing with the brand icon. Returns None for unknown."""
    from reportlab.graphics.shapes import Drawing, Path
    from reportlab.lib.colors import HexColor

    path_data = BRAND_PATHS.get(provider, "")
    color_hex = BRAND_COLORS.get(provider, "")
    if not path_data or not color_hex:
        return None

    scale = size / 24.0
    d = Drawing(size, size)
    rp = Path(strokeColor=None, fillColor=HexColor(color_hex))
    try:
        _parse_svg_path_into_reportlab(rp, path_data, scale, size)
    except Exception:
        return None
    d.add(rp)
    return d


def badge_png_path(provider: str, px: int = 28) -> str | None:
    """Return path to a cached PNG badge for *provider*, or None if unavailable.

    Draws a rounded-square filled with ``BRAND_COLORS[provider]`` and a short
    white glyph (github→"GH", linkedin→"in", facebook→"f", website→"@").
    Renders at 3× resolution then downscales with LANCZOS for crispness.

    Caches under ``tempfile.gettempdir()/claude_brand_badges/``.
    Idempotent — returns the cached path immediately if the file already exists.
    Returns None for unknown providers or when PIL/Pillow is not importable.
    """
    if provider not in BRAND_COLORS:
        return None

    asset = asset_path(provider, raster_only=True)
    if asset is not None:
        return _resized_raster_asset(asset, provider, px)

    import tempfile

    cache_dir = os.path.join(tempfile.gettempdir(), "claude_brand_badges")
    os.makedirs(cache_dir, exist_ok=True)
    out_path = os.path.join(cache_dir, f"{provider}_{px}.png")

    if os.path.exists(out_path):
        return out_path

    try:
        from PIL import Image, ImageDraw, ImageFont  # type: ignore[import]
    except ImportError:
        return None

    try:
        scale = 3
        size = px * scale
        color_hex = BRAND_COLORS[provider]
        r = int(color_hex[1:3], 16)
        g = int(color_hex[3:5], 16)
        b = int(color_hex[5:7], 16)

        glyphs: dict[str, str] = {
            "github": "GH",
            "linkedin": "in",
            "facebook": "f",
            "website": "@",
        }
        glyph = glyphs.get(provider, "?")

        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        radius = size // 4
        # rounded_rectangle available since Pillow 8.2
        draw.rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=radius, fill=(r, g, b, 255)
        )

        font = None
        font_size = max(6, size // 2)
        for font_name in ("arial.ttf", "Arial.ttf", "DejaVuSans.ttf", "FreeSans.ttf"):
            try:
                font = ImageFont.truetype(font_name, font_size)
                break
            except Exception:
                continue
        if font is None:
            try:
                font = ImageFont.load_default()
            except Exception:
                pass

        if font is not None:
            try:
                bbox = draw.textbbox((0, 0), glyph, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                offset_x = bbox[0]
                offset_y = bbox[1]
            except AttributeError:
                # Pillow < 8.0 fallback
                tw, th = draw.textsize(glyph, font=font)  # type: ignore[attr-defined]
                offset_x = offset_y = 0
            tx = (size - tw) // 2 - offset_x
            ty = (size - th) // 2 - offset_y
            draw.text((tx, ty), glyph, fill=(255, 255, 255, 255), font=font)

        small = img.resize((px, px), Image.LANCZOS)
        small.save(out_path, "PNG")
        return out_path
    except Exception:
        return None


def _resized_raster_asset(asset: Path, provider: str, px: int) -> str | None:
    try:
        from PIL import Image  # type: ignore[import]
    except ImportError:
        return None

    import tempfile

    cache_dir = Path(tempfile.gettempdir()) / "claude_brand_badges"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_key = f"{provider}_{asset.stem}_{asset.stat().st_mtime_ns}_{px}.png"
    out_path = cache_dir / cache_key
    if out_path.exists():
        return str(out_path)

    try:
        with Image.open(asset) as img:
            img = img.convert("RGBA")
            img.thumbnail((px, px), Image.LANCZOS)
            canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
            x = (px - img.width) // 2
            y = (px - img.height) // 2
            canvas.alpha_composite(img, (x, y))
            canvas.save(out_path, "PNG")
        return str(out_path)
    except Exception:
        return None


def _normalize_provider(provider: str) -> str:
    provider_key = (provider or "").strip().lower()
    if provider_key in {"fb", "facebook"}:
        return "facebook"
    return provider_key


def _mime_for_suffix(suffix: str) -> str:
    return {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(suffix.lower(), "application/octet-stream")


def declutter(url: str | None, provider_hint: str = "") -> tuple[str | None, str | None]:
    """Return (provider, handle) with no scheme/www/domain noise.

    handle is None for Facebook post/permalink URLs.
    """
    if not url:
        return (None, None)

    hint = provider_hint.lower()

    # Bare handle without scheme — use provider_hint to identify
    if not url.startswith(("http://", "https://")):
        if hint == "github":
            return ("github", url.lstrip("/") or None)
        if hint == "linkedin":
            return ("linkedin", url.lstrip("/") or None)
        if hint == "facebook":
            return ("facebook", url.lstrip("/") or None)
        return (hint or "website", url)

    cleaned = re.sub(r"^https?://", "", url.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"^www\.", "", cleaned, flags=re.IGNORECASE).rstrip("/")
    low = cleaned.lower()

    if "github.com/" in low:
        path = cleaned.split("github.com/", 1)[1]
        return ("github", path or None)

    if "linkedin.com/in/" in low:
        path = cleaned.split("linkedin.com/in/", 1)[1]
        return ("linkedin", path or None)

    if "facebook.com/" in low or hint == "facebook":
        if "facebook.com/" in low:
            path = cleaned.split("facebook.com/", 1)[1]
        else:
            path = None
        # Detect post/permalink URLs that shouldn't be shown as handles
        if path and re.search(
            r"(posts|permalink|photo|videos|\d{6,})", path, re.IGNORECASE
        ):
            return ("facebook", None)
        return ("facebook", path or None)

    return (hint or "website", cleaned)


# ---------------------------------------------------------------------------
# Internal: SVG path parser → reportlab Path
# ---------------------------------------------------------------------------

def _parse_svg_path_into_reportlab(
    p, path_data: str, scale: float, size: float
) -> None:
    """Parse SVG path data and emit reportlab Path commands.

    Handles: M m L l H h V v C c S s Z z A a
    Y-axis is flipped: y_reportlab = size - y_svg * scale
    """
    s = path_data
    n = len(s)
    pos = [0]

    _num_re = re.compile(
        r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?"
    )

    def skip() -> None:
        while pos[0] < n and s[pos[0]] in " \t\n\r,":
            pos[0] += 1

    def read_num() -> float:
        skip()
        m = _num_re.match(s, pos[0])
        if not m:
            raise ValueError(f"Expected number near {pos[0]}: {s[pos[0]:pos[0]+20]!r}")
        pos[0] = m.end()
        return float(m.group())

    def read_flag() -> int:
        """Read a single binary digit (0 or 1) for arc flag parameters."""
        skip()
        if pos[0] < n and s[pos[0]] in "01":
            v = int(s[pos[0]])
            pos[0] += 1
            return v
        raise ValueError(f"Expected flag at pos {pos[0]}")

    def has_more() -> bool:
        j = pos[0]
        while j < n and s[j] in " \t\n\r,":
            j += 1
        if j >= n:
            return False
        return s[j] not in "MmLlHhVvCcSsZzAa"

    def tx(x: float) -> float:
        return x * scale

    def ty(y: float) -> float:
        return size - y * scale

    cx = cy = 0.0   # current point
    sx = sy = 0.0   # subpath start (for Z)
    lx = ly = 0.0   # last control point (for S/s smooth cubics)

    while pos[0] < n:
        skip()
        if pos[0] >= n:
            break
        if s[pos[0]] not in "MmLlHhVvCcSsZzAa":
            break
        cmd = s[pos[0]]
        pos[0] += 1

        first = True
        while first or (cmd not in ("Z", "z") and has_more()):
            first = False
            try:
                if cmd == "M":
                    cx, cy = read_num(), read_num()
                    p.moveTo(tx(cx), ty(cy))
                    sx, sy = cx, cy
                    lx, ly = cx, cy
                    cmd = "L"

                elif cmd == "m":
                    cx += read_num()
                    cy += read_num()
                    p.moveTo(tx(cx), ty(cy))
                    sx, sy = cx, cy
                    lx, ly = cx, cy
                    cmd = "l"

                elif cmd == "L":
                    cx, cy = read_num(), read_num()
                    p.lineTo(tx(cx), ty(cy))
                    lx, ly = cx, cy

                elif cmd == "l":
                    cx += read_num()
                    cy += read_num()
                    p.lineTo(tx(cx), ty(cy))
                    lx, ly = cx, cy

                elif cmd == "H":
                    cx = read_num()
                    p.lineTo(tx(cx), ty(cy))

                elif cmd == "h":
                    cx += read_num()
                    p.lineTo(tx(cx), ty(cy))

                elif cmd == "V":
                    cy = read_num()
                    p.lineTo(tx(cx), ty(cy))

                elif cmd == "v":
                    cy += read_num()
                    p.lineTo(tx(cx), ty(cy))

                elif cmd == "C":
                    x1, y1 = read_num(), read_num()
                    x2, y2 = read_num(), read_num()
                    ex, ey = read_num(), read_num()
                    p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(ex), ty(ey))
                    lx, ly = x2, y2
                    cx, cy = ex, ey

                elif cmd == "c":
                    dx1, dy1 = read_num(), read_num()
                    dx2, dy2 = read_num(), read_num()
                    dx, dy = read_num(), read_num()
                    x1, y1 = cx + dx1, cy + dy1
                    x2, y2 = cx + dx2, cy + dy2
                    ex, ey = cx + dx, cy + dy
                    p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(ex), ty(ey))
                    lx, ly = x2, y2
                    cx, cy = ex, ey

                elif cmd == "S":
                    x1, y1 = 2 * cx - lx, 2 * cy - ly
                    x2, y2 = read_num(), read_num()
                    ex, ey = read_num(), read_num()
                    p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(ex), ty(ey))
                    lx, ly = x2, y2
                    cx, cy = ex, ey

                elif cmd == "s":
                    x1, y1 = 2 * cx - lx, 2 * cy - ly
                    dx2, dy2 = read_num(), read_num()
                    dx, dy = read_num(), read_num()
                    x2, y2 = cx + dx2, cy + dy2
                    ex, ey = cx + dx, cy + dy
                    p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(ex), ty(ey))
                    lx, ly = x2, y2
                    cx, cy = ex, ey

                elif cmd in ("Z", "z"):
                    p.closePath()
                    cx, cy = sx, sy
                    lx, ly = cx, cy
                    break

                elif cmd in ("A", "a"):
                    rx_val = abs(read_num())
                    ry_val = abs(read_num())
                    phi = math.radians(read_num())
                    fa = read_flag()
                    fs = read_flag()
                    if cmd == "A":
                        ex, ey = read_num(), read_num()
                    else:
                        ex, ey = cx + read_num(), cy + read_num()
                    _arc(p, cx, cy, ex, ey, rx_val, ry_val, phi, fa, fs, tx, ty)
                    lx, ly = cx, cy
                    cx, cy = ex, ey

            except (ValueError, IndexError, StopIteration):
                break


def _arc(
    p,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    rx: float,
    ry: float,
    phi: float,
    fa: int,
    fs: int,
    tx,
    ty,
) -> None:
    """Convert an SVG arc (endpoint parameterisation) to cubic bezier curves."""
    if x1 == x2 and y1 == y2:
        return
    if rx == 0 or ry == 0:
        p.lineTo(tx(x2), ty(y2))
        return

    cp, sp = math.cos(phi), math.sin(phi)

    # Step 1: rotate midpoint to remove x-axis rotation
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cp * dx + sp * dy
    y1p = -sp * dx + cp * dy

    x1p2, y1p2 = x1p * x1p, y1p * y1p
    rx2, ry2 = rx * rx, ry * ry

    # Clamp radii when too small
    lam = x1p2 / rx2 + y1p2 / ry2
    if lam > 1:
        sl = math.sqrt(lam)
        rx *= sl
        ry *= sl
        rx2 = rx * rx
        ry2 = ry * ry

    # Step 2: find centre in rotated space
    den = rx2 * y1p2 + ry2 * x1p2
    sq = (
        math.sqrt(max(0.0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / den))
        if den
        else 0.0
    )
    if fa == fs:
        sq = -sq

    cxp = sq * rx * y1p / ry
    cyp = -sq * ry * x1p / rx

    # Step 3: rotate back to world space
    ccx = cp * cxp - sp * cyp + (x1 + x2) / 2
    ccy = sp * cxp + cp * cyp + (y1 + y2) / 2

    def _angle(ux: float, uy: float, vx: float, vy: float) -> float:
        n = math.sqrt(ux * ux + uy * uy) * math.sqrt(vx * vx + vy * vy)
        if not n:
            return 0.0
        a = math.acos(max(-1.0, min(1.0, (ux * vx + uy * vy) / n)))
        return -a if ux * vy - uy * vx < 0 else a

    ux = (x1p - cxp) / rx
    uy = (y1p - cyp) / ry
    vx = (-x1p - cxp) / rx
    vy = (-y1p - cyp) / ry

    theta = _angle(1.0, 0.0, ux, uy)
    dtheta = _angle(ux, uy, vx, vy)

    if not fs and dtheta > 0:
        dtheta -= 2 * math.pi
    elif fs and dtheta < 0:
        dtheta += 2 * math.pi

    # Subdivide into ≤ 90° segments
    n_segs = max(1, math.ceil(abs(dtheta) / (math.pi / 2)))
    d = dtheta / n_segs

    for _ in range(n_segs):
        k = (4.0 / 3.0) * math.tan(d / 4.0)
        ct, st = math.cos(theta), math.sin(theta)
        ct2, st2 = math.cos(theta + d), math.sin(theta + d)

        xe = cp * rx * ct2 - sp * ry * st2 + ccx
        ye = sp * rx * ct2 + cp * ry * st2 + ccy

        bx1 = (cp * rx * ct - sp * ry * st + ccx) + k * (-(rx * cp * st + ry * sp * ct))
        by1 = (sp * rx * ct + cp * ry * st + ccy) + k * (-(rx * sp * st - ry * cp * ct))
        bx2 = xe - k * (rx * cp * st2 + ry * sp * ct2)
        by2 = ye - k * (rx * sp * st2 - ry * cp * ct2)

        p.curveTo(tx(bx1), ty(by1), tx(bx2), ty(by2), tx(xe), ty(ye))
        theta += d
