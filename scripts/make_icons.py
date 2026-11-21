"""Renders the app icons in public/icons from inline SVG (needs PyMuPDF).

    python scripts/make_icons.py
"""
import os
import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons")
os.makedirs(OUT, exist_ok=True)

BUBBLE = (
    "M128 150 h256 a40 40 0 0 1 40 40 v120 a40 40 0 0 1 -40 40 h-120 "
    "l-72 60 v-60 h-64 a40 40 0 0 1 -40 -40 v-120 a40 40 0 0 1 40 -40z"
)
DOTS = "".join(f'<circle cx="{x}" cy="250" r="21" fill="#fbf6eb"/>' for x in (196, 256, 316))


def svg(rounded: bool, scale: float = 1.0) -> str:
    rx = 112 if rounded else 0
    t = (1 - scale) * 256
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
        f'<rect width="512" height="512" rx="{rx}" fill="#0c1a42"/>'
        f'<g transform="translate({t} {t}) scale({scale})">'
        f'<path d="{BUBBLE}" fill="#dcae47"/>{DOTS}</g></svg>'
    )


BADGE = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
    f'<path d="{BUBBLE}" fill="#ffffff" transform="translate(-26 -40) scale(1.1)"/></svg>'
)


def render(markup: str, name: str, size: int, alpha: bool = False) -> None:
    doc = fitz.open(stream=markup.encode("utf-8"), filetype="svg")
    page = doc[0]
    zoom = size / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=alpha)
    pix.save(os.path.join(OUT, name))
    print("wrote", name, pix.width, "x", pix.height)


render(svg(True), "icon-192.png", 192, alpha=True)
render(svg(True), "icon-512.png", 512, alpha=True)
render(svg(False, 0.78), "maskable-512.png", 512)
render(svg(False), "apple-touch-icon.png", 180)
render(BADGE, "badge-96.png", 96, alpha=True)
