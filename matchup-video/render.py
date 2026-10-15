import math, sys, subprocess, functools
import numpy as np
from multiprocessing import Pool
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from timeline import *

GOLD = (245, 195, 80); VIOLET = (195, 115, 255); WHITE = (255, 255, 255)
FD = "fonts/"
@functools.lru_cache(None)
def font(name, size):
    path = {"anton": "Anton-Regular.ttf", "bebas": "BebasNeue-Regular.ttf", "oswald": "Oswald.ttf"}[name]
    f = ImageFont.truetype(FD + path, size)
    if name == "oswald":
        try: f.set_variation_by_axes([600])
        except Exception: pass
    return f

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_back(x):
    x = clamp(x); c = 1.70158
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
def prog(t, t0, d): return clamp((t - t0) / d)

# ---------- static assets ----------
def make_bg():
    y = np.linspace(0, 1, H)[:, None]; x = np.linspace(0, 1, W)[None, :]
    top = np.array([12, 5, 28]); bot = np.array([42, 12, 72])
    img = np.broadcast_to(top + (bot - top) * y[..., None], (H, W, 3)).astype(float).copy()
    for (cx, cy, col, r) in [(0.1, 0.18, (120, 80, 20), 0.55), (0.95, 0.8, (90, 30, 140), 0.6)]:
        d = np.sqrt(((x - cx) * W / H) ** 2 + (y - cy) ** 2)
        img += np.array(col) * np.exp(-(d / r) ** 2)[..., None] * 0.6
    d = np.sqrt(((x - 0.5) * 1.2) ** 2 + (y - 0.5) ** 2)
    img *= (1 - 0.55 * clamp_arr(d - 0.3))[..., None]
    # diagonal light beams
    beam = np.sin((x * W * 0.6 + y * H * 0.35) / 90) ** 16 * 10
    img += beam[..., None] * np.array([1, 0.7, 1.2])
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert("RGBA")

def clamp_arr(a): return np.clip(a, 0, 1)

BG = make_bg()
AV = {"L": Image.open("left.png").convert("RGBA"), "R": Image.open("right.png").convert("RGBA")}
@functools.lru_cache(None)
def avatar(side, size, ring):
    a = AV[side].resize((size, size), Image.LANCZOS)
    pad = 24; out = Image.new("RGBA", (size + 2 * pad,) * 2, (0, 0, 0, 0))
    col = GOLD if side == "L" else VIOLET
    g = Image.new("RGBA", out.size, (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    d.ellipse((pad - 6, pad - 6, pad + size + 6, pad + size + 6), fill=col + (200,))
    out = Image.alpha_composite(out, g.filter(ImageFilter.GaussianBlur(12)))
    if ring:
        ImageDraw.Draw(out).ellipse((pad - 5, pad - 5, pad + size + 5, pad + size + 5), outline=col + (255,), width=5)
    out.alpha_composite(a, (pad, pad))
    return out

rngp = np.random.default_rng(3)
PARTS = [(rngp.random() * W, rngp.random() * H, 20 + rngp.random() * 70, 1 + rngp.random() * 3.5,
          rngp.random() * 6.28, 0.3 + rngp.random() * 0.7) for _ in range(160)]

# ---------- text sprites ----------
@functools.lru_cache(4096)
def text_sprite(text, fname, size, fill, glow=None, glow_r=14, stroke=0, track=0):
    f = font(fname, size)
    bb = f.getbbox(text, stroke_width=stroke)
    tw = bb[2] - bb[0] + track * max(0, len(text) - 1); th = bb[3] - bb[1]
    pad = glow_r * 3 + 6
    img = Image.new("RGBA", (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0))
    def draw_on(im, col, sw=stroke):
        d = ImageDraw.Draw(im)
        if track == 0:
            d.text((pad - bb[0], pad - bb[1]), text, font=f, fill=col, stroke_width=sw, stroke_fill=col if sw else None)
        else:
            x = pad - bb[0]
            for ch in text:
                d.text((x, pad - bb[1]), ch, font=f, fill=col, stroke_width=sw, stroke_fill=col if sw else None)
                x += f.getlength(ch) + track
    if glow:
        g = Image.new("RGBA", img.size, (0, 0, 0, 0)); draw_on(g, glow + (255,), stroke + 3)
        img = Image.alpha_composite(img, g.filter(ImageFilter.GaussianBlur(glow_r)))
    draw_on(img, fill + (255,) if len(fill) == 3 else fill, 0)
    return img

def fit_size(text, fname, maxw, maxsize):
    s = maxsize
    while s > 20 and font(fname, s).getlength(text) > maxw: s -= 2
    return s

def put(canvas, spr, cx, cy, alpha=1.0, scale=1.0, anchor="c"):
    if alpha <= 0.01: return
    if abs(scale - 1) > 0.005:
        spr = spr.resize((max(1, int(spr.width * scale)), max(1, int(spr.height * scale))), Image.BILINEAR)
    if alpha < 0.999:
        a = spr.getchannel("A").point(lambda v: int(v * alpha)); spr = spr.copy(); spr.putalpha(a)
    x = int(cx - spr.width / 2) if anchor == "c" else int(cx - (spr.width if anchor == "r" else 0))
    y = int(cy - spr.height / 2)
    sx0, sy0 = max(0, -x), max(0, -y)
    sx1, sy1 = min(spr.width, W - x), min(spr.height, H - y)
    if sx1 <= sx0 or sy1 <= sy0: return
    canvas.alpha_composite(spr.crop((sx0, sy0, sx1, sy1)) if (sx0 or sy0 or sx1 < spr.width or sy1 < spr.height) else spr,
                           (x + sx0, y + sy0))

def T(canvas, text, fname, size, cx, cy, fill=WHITE, glow=None, alpha=1, scale=1, glow_r=14, anchor="c", track=0):
    pad = (glow_r * 3 + 6) * scale
    cx = cx - pad if anchor == "l" else cx + pad if anchor == "r" else cx
    put(canvas, text_sprite(text, fname, size, fill, glow, glow_r, 0, track), cx, cy, alpha, scale, anchor)

# ---------- cards ----------
CW, CH = 490, 640
@functools.lru_cache(None)
def card_sprite(i, side, state):
    d = DUELS[i]; p = d[2] if side == "L" else d[3]
    col = GOLD if side == "L" else VIOLET
    pad = 40
    img = Image.new("RGBA", (CW + 2 * pad, CH + 2 * pad), (0, 0, 0, 0))
    if state == "win":
        g = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(g).rounded_rectangle((pad, pad, pad + CW, pad + CH), 36, fill=col + (255,))
        img = Image.alpha_composite(img, g.filter(ImageFilter.GaussianBlur(22)))
    dr = ImageDraw.Draw(img)
    dr.rounded_rectangle((pad, pad, pad + CW, pad + CH), 36, fill=(18, 8, 38, 235),
                         outline=col + (255 if state == "win" else 170,), width=6 if state == "win" else 3)
    # top band
    dr.rounded_rectangle((pad + 3, pad + 3, pad + CW - 3, pad + 120), 34, fill=col + (40,))
    av = avatar(side, 76, True); img.alpha_composite(av, (pad + 4, pad + 60 - av.height // 2))
    team = L_TEAM if side == "L" else R_TEAM
    ts = fit_size(team, "bebas", CW - 140, 52)
    dr.text((pad + 118, pad + 60), team, font=font("bebas", ts), fill=col, anchor="lm")
    ns = fit_size(p[0], "anton", CW - 50, 100)
    sp = text_sprite(p[0], "anton", ns, WHITE, col if state == "win" else None, 12)
    img.alpha_composite(sp, (pad + CW // 2 - sp.width // 2, pad + 215 - sp.height // 2))
    dr.text((pad + CW // 2, pad + 305), p[1], font=font("bebas", 54), fill=(200, 190, 220), anchor="mm")
    dr.line((pad + 60, pad + 360, pad + CW - 60, pad + 360), fill=col + (90,), width=2)
    dr.text((pad + CW // 2, pad + 600), "PROJECTED PTS", font=font("bebas", 40), fill=(170, 160, 200), anchor="mm")
    if state == "lose":
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
        od.rounded_rectangle((pad, pad, pad + CW, pad + CH), 36, fill=(5, 0, 12, 140))
        # slash
        od.line((pad + 30, pad + CH - 90, pad + CW - 30, pad + 90), fill=(255, 70, 90, 210), width=10)
        od.line((pad + 50, pad + CH - 60, pad + CW - 10, pad + 120), fill=(255, 200, 200, 120), width=3)
        img = Image.alpha_composite(img, ov)
    return img

# ---------- scene pieces ----------
def draw_particles(c, t):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for x0, y0, sp, sz, ph, br in PARTS:
        y = (y0 - sp * t) % H; x = (x0 + 30 * math.sin(t * 0.7 + ph) + 25 * t) % W
        a = int(255 * br * (0.55 + 0.45 * math.sin(t * 2 + ph)))
        d.ellipse((x - sz, y - sz, x + sz, y + sz), fill=(255, 205, 120, a))
    c.alpha_composite(layer)

def tally(c, t, i, alpha=1.0):
    """running tally at bottom during duel i"""
    hit = impact_time(i)
    pl, pr = (CUM[i - 1] if i > 0 else (0.0, 0.0))
    nl, nr = CUM[i]
    k = ease_out(prog(t, hit, 0.6))
    l = pl + (nl - pl) * k; r = pr + (nr - pr) * k
    y = 1705
    panel = Image.new("RGBA", (W, H), (0, 0, 0, 0)); pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle((30, 1590, W - 30, 1875), 34, fill=(10, 4, 24, int(210 * alpha)), outline=(255, 255, 255, int(40 * alpha)), width=2)
    c.alpha_composite(panel)
    T(c, "THE WAR", "bebas", 40, W / 2, 1625, (200, 190, 230), alpha=alpha, track=6)
    put(c, avatar("L", 110, True), 110, y + 20, alpha)
    put(c, avatar("R", 110, True), W - 110, y + 20, alpha)
    T(c, f"{l:.2f}", "anton", 78, 195, y - 8, WHITE, GOLD if l > r else None, alpha, anchor="l", glow_r=10)
    T(c, f"{r:.2f}", "anton", 78, W - 195, y - 8, WHITE, VIOLET if r > l else None, alpha, anchor="r", glow_r=10)
    # tug of war bar
    bx0, bx1, by = 190, W - 190, 1782
    lead = l - r
    mid = (bx0 + bx1) / 2 - clamp(lead / 8, -1, 1) * (bx1 - bx0) / 2 * 0.9
    bar = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bar)
    bd.rounded_rectangle((bx0, by - 9, mid, by + 9), 9, fill=GOLD + (int(255 * alpha),))
    bd.rounded_rectangle((mid, by - 9, bx1, by + 9), 9, fill=VIOLET + (int(255 * alpha),))
    bd.ellipse((mid - 16, by - 16, mid + 16, by + 16), fill=(255, 255, 255, int(255 * alpha)))
    c.alpha_composite(bar)
    if abs(lead) < 0.005: msg, col = "DEAD EVEN", WHITE
    elif lead > 0: msg, col = f"LISAN LEADS BY {lead:.2f}", GOLD
    else: msg, col = f"ALGERNON LEADS BY {-lead:.2f}", VIOLET
    T(c, msg, "bebas", 46, W / 2, 1835, col, alpha=alpha, track=2)

def wrap(text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        nxt = (cur + " " + w).strip()
        if f.getlength(nxt) > maxw and cur: lines.append(cur); cur = w
        else: cur = nxt
    lines.append(cur); return lines

def duel(c, t, i):
    d = DUELS[i]; s = duel_start(i); lb = (t - s) / BEAT
    pos, pcol = d[0], d[1]
    lp, rp = d[2], d[3]
    lwin = lp[2] > rp[2]
    out = ease_out(prog(lb, 9.3, 0.7))  # exit
    a_all = 1 - out
    # round label + badge
    T(c, f"ROUND {i + 1} OF 9", "bebas", 52, W / 2, 105, (210, 200, 235), alpha=a_all * ease_out(prog(lb, 0, 0.3)), track=4)
    bk = prog(lb, 0, 0.45)
    bsc = 1.8 - 0.8 * ease_out(bk)
    badge = badge_sprite(pos, pcol)
    put(c, badge, W / 2, 245, a_all * clamp(bk * 3), bsc)
    tk = ease_out(prog(lb, 0.4, 0.6))
    T(c, d[4], "anton", fit_size(d[4], "anton", 980, 84), W / 2, 395 + 30 * (1 - tk), GOLD, (120, 60, 0), a_all * tk, glow_r=16)
    # cards
    hit = lb >= IMPACT_BEAT
    sk_l = ease_back(prog(lb, 0.3, 0.9)); sk_r = ease_back(prog(lb, 0.5, 0.9))
    cy = 830
    for side, sk, cx0 in (("L", sk_l, 285), ("R", sk_r, W - 285)):
        win = (side == "L") == lwin
        state = ("win" if win else "lose") if hit else "idle"
        off = (1 - sk) * (-700 if side == "L" else 700) + out * (-700 if side == "L" else 700)
        pk = prog(lb, IMPACT_BEAT, 0.35)
        sc = 1.0 + (0.06 * math.sin(pk * math.pi) + 0.03 * pk if (hit and win) else 0) - (0.04 * pk if hit and not win else 0)
        put(c, card_sprite(i, side, state), cx0 + off, cy, a_all, sc)
        # points
        p = (lp if side == "L" else rp)[2]
        ck = ease_out(prog(lb, 1.2, IMPACT_BEAT - 1.3))
        val = p * ck if lb < IMPACT_BEAT else p
        col = (GOLD if side == "L" else VIOLET)
        glow = col if (hit and win) else None
        fill = WHITE if (not hit or win) else (140, 130, 160)
        T(c, f"{val:.2f}", "anton", int(150 * sc), cx0 + off, cy + 120, fill, glow, a_all * clamp(sk * 2), glow_r=18)
    # VS bubble
    vk = ease_back(prog(lb, 0.9, 0.4))
    if vk > 0:
        vs = vs_sprite(); put(c, vs, W / 2, cy - 40, a_all * clamp(vk), 0.6 + 0.4 * vk)
    # damage text
    if hit:
        dk = prog(lb, IMPACT_BEAT, 0.35)
        margin = abs(lp[2] - rp[2]); wcol = GOLD if lwin else VIOLET
        wname = (lp if lwin else rp)[0].split(". ")[-1]
        T(c, f"+{margin:.2f}", "anton", 120, W / 2, 1245, WHITE, wcol, a_all * clamp(dk * 3), 2.0 - ease_out(dk), glow_r=20)
        T(c, f"{wname} TAKES THE DUEL", "bebas", 58, W / 2, 1330, wcol, alpha=a_all * ease_out(prog(lb, IMPACT_BEAT + 0.2, 0.4)), track=3)
    # commentary typewriter
    ck0 = IMPACT_BEAT + 0.8
    if lb > ck0:
        f = font("oswald", 46)
        full = d[5]; nchar = int(len(full) * clamp((lb - ck0) / 2.6))
        lines = wrap(full, f, 900)
        box = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(box)
        ba = a_all * ease_out(prog(lb, ck0, 0.3))
        bh = 70 + 62 * len(lines)
        bd.rectangle((70, 1400, 78, 1400 + bh), fill=GOLD + (int(255 * ba),))
        shown = 0
        for li, line in enumerate(lines):
            seg = line[: max(0, nchar - shown)]; shown += len(line) + 1
            bd.text((105, 1435 + li * 62), seg, font=f, fill=(255, 255, 255, int(255 * ba)))
        c.alpha_composite(box)

@functools.lru_cache(None)
def badge_sprite(pos, col):
    w, h, pad = 260, 160, 40
    img = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    g = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(g).rounded_rectangle((pad, pad, pad + w, pad + h), 30, fill=col + (200,))
    img = Image.alpha_composite(img, g.filter(ImageFilter.GaussianBlur(20)))
    ImageDraw.Draw(img).rounded_rectangle((pad, pad, pad + w, pad + h), 30, fill=(22, 12, 40, 255), outline=col + (255,), width=5)
    sp = text_sprite(pos, "anton", 110 if len(pos) < 3 else 96, col, None, 1)
    img.alpha_composite(sp, (img.width // 2 - sp.width // 2, img.height // 2 - sp.height // 2))
    return img

@functools.lru_cache(None)
def vs_sprite():
    r, pad = 70, 30; img = Image.new("RGBA", (2 * (r + pad),) * 2, (0, 0, 0, 0))
    g = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse((pad, pad, pad + 2 * r, pad + 2 * r), fill=(255, 80, 80, 220))
    img = Image.alpha_composite(img, g.filter(ImageFilter.GaussianBlur(16)))
    ImageDraw.Draw(img).ellipse((pad, pad, pad + 2 * r, pad + 2 * r), fill=(30, 8, 30, 255), outline=(255, 90, 90, 255), width=5)
    sp = text_sprite("VS", "anton", 72, WHITE, None, 1)
    img.alpha_composite(sp, (img.width // 2 - sp.width // 2, img.height // 2 - sp.height // 2 - 4))
    return img

def intro(c, t):
    b = t / BEAT
    g1 = 1 - ease_out(prog(b, 7.6, 0.5))  # team block exit
    k = prog(b, 0, 0.5)
    T(c, "WEEK 6", "anton", 150, W / 2, 190, GOLD, (140, 70, 0), clamp(k * 3) * g1, 1.6 - 0.6 * ease_out(k), glow_r=22)
    T(c, "H2H POINTS · A PROPHECY IN NINE DUELS", "bebas", 46, W / 2, 300, (210, 200, 235), alpha=ease_out(prog(b, 0.8, 0.6)) * g1, track=3)
    kl = ease_back(prog(b, 2, 0.8)); kr = ease_back(prog(b, 4, 0.8))
    put(c, avatar("L", 300, True), W / 2 + (kl - 1) * 900, 600, clamp(kl * 2) * g1)
    T(c, L_TEAM, "anton", 100, W / 2 + (kl - 1) * 900, 820, WHITE, GOLD, clamp(kl * 2) * g1, glow_r=18)
    vk = prog(b, 6, 0.3)
    T(c, "VS", "anton", 170, W / 2, 1000, (255, 90, 90), (200, 0, 30), clamp(vk * 3) * g1, 2.4 - 1.4 * ease_out(vk), glow_r=26)
    put(c, avatar("R", 300, True), W / 2 + (1 - kr) * 900, 1290, clamp(kr * 2) * g1)
    T(c, R_TEAM, "anton", fit_size(R_TEAM, "anton", 1000, 100), W / 2 + (1 - kr) * 900, 1510, WHITE, VIOLET, clamp(kr * 2) * g1, glow_r=18)
    # oracle
    ok = ease_out(prog(b, 8.2, 0.6)); oo = 1 - ease_out(prog(b, 11.6, 0.4))
    if ok > 0 and oo > 0:
        a = ok * oo
        T(c, "THE ORACLE HAS SPOKEN", "anton", 84, W / 2, 620, GOLD, (120, 60, 0), a, glow_r=16)
        bk = ease_out(prog(b, 8.8, 1.6))
        lp = 49 * bk; rp = 51 * bk
        T(c, f"{lp:.0f}%", "anton", 200, 290, 880, WHITE, GOLD, a, glow_r=20)
        T(c, f"{rp:.0f}%", "anton", 200, W - 290, 880, WHITE, VIOLET, a, glow_r=20)
        put(c, avatar("L", 130, True), 290, 1080, a); put(c, avatar("R", 130, True), W - 290, 1080, a)
        bar = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bar)
        x0, x1, y = 120, W - 120, 1240; mid = x0 + (x1 - x0) * (0.5 + (0.49 - 0.5) * bk)
        bd.rounded_rectangle((x0, y - 14, mid, y + 14), 14, fill=GOLD + (int(255 * a),))
        bd.rounded_rectangle((mid, y - 14, x1, y + 14), 14, fill=VIOLET + (int(255 * a),))
        c.alpha_composite(bar)
        T(c, "A COIN FLIP WITH A THUMB ON THE SCALE.", "bebas", 56, W / 2, 1340, (220, 210, 240), alpha=a * ease_out(prog(b, 10, 0.5)), track=2)
    for bb, txt, y, col in ((12, "NINE DUELS.", 820, WHITE), (14, "ONE SURVIVOR.", 1000, (255, 90, 90))):
        k2 = prog(b, bb, 0.3); a2 = clamp(k2 * 3) * (1 - ease_out(prog(b, 15.6, 0.4)))
        T(c, txt, "anton", 140, W / 2, y, col, (150, 20, 40) if bb == 14 else (120, 60, 0), a2, 1.6 - 0.6 * ease_out(k2), glow_r=22)

def recap(c, t):
    b = t / BEAT - TALLY0
    a = 1 - ease_out(prog(b, 11.6, 0.4))
    k = ease_out(prog(b, 0, 0.6))
    T(c, "THE DUST SETTLES", "anton", 104, W / 2, 170 + 30 * (1 - k), GOLD, (120, 60, 0), k * a, glow_r=18)
    put(c, avatar("L", 110, True), 270, 340, k * a); put(c, avatar("R", 110, True), W - 270, 340, k * a)
    y0, rh = 450, 108
    for i, d in enumerate(DUELS):
        rk = ease_out(prog(b, 0.6 + i * 0.35, 0.4))
        if rk <= 0: continue
        y = y0 + i * rh; lw = d[2][2] > d[3][2]
        row = Image.new("RGBA", (W, H), (0, 0, 0, 0)); rd = ImageDraw.Draw(row)
        ra = rk * a
        rd.rounded_rectangle((60, y - 44, W - 60, y + 44), 20, fill=(20, 10, 40, int(200 * ra)))
        hx = (60, W // 2 - 62) if lw else (W // 2 + 62, W - 60)
        rd.rounded_rectangle((hx[0], y - 44, hx[1], y + 44), 20, fill=(GOLD if lw else VIOLET) + (int(60 * ra),))
        c.alpha_composite(row)
        dx = (1 - rk) * 80
        T(c, d[2][0], "bebas", 44, 88 - dx, y, WHITE if lw else (150, 140, 170), alpha=ra, anchor="l")
        T(c, f"{d[2][2]:.2f}", "anton", 48, W // 2 - 72 - dx, y, GOLD if lw else (150, 140, 170), alpha=ra, anchor="r")
        put(c, badge_sprite(d[0], d[1]), W / 2, y, ra, 0.34)
        T(c, f"{d[3][2]:.2f}", "anton", 48, W // 2 + 72 + dx, y, VIOLET if not lw else (150, 140, 170), alpha=ra, anchor="l")
        T(c, d[3][0], "bebas", 44, W - 88 + dx, y, WHITE if not lw else (150, 140, 170), alpha=ra, anchor="r")
    s1 = ease_out(prog(b, 5, 0.5)); s2 = ease_out(prog(b, 8, 0.5))
    T(c, "LISAN WINS 6 OF 9 DUELS...", "anton", 76, W / 2, 1490, GOLD, (120, 60, 0), s1 * a, glow_r=14)
    T(c, "...BUT WARS ARE WON ON POINTS.", "anton", 76, W / 2, 1600, (255, 110, 110), (150, 20, 40), s2 * a, glow_r=14)

def verdict(c, t):
    b = t / BEAT - VERDICT0
    a1 = 1 - ease_out(prog(b, 11.5, 0.5))
    k = prog(b, 0, 0.4)
    if a1 > 0:
        T(c, "THE PROJECTION", "bebas", 60, W / 2, 200, (210, 200, 235), alpha=clamp(k * 3) * a1, track=8)
        put(c, avatar("L", 220, False), 280, 420, clamp(k * 3) * a1 * 0.75)
        put(c, avatar("R", 260, True), W - 280, 420, clamp(k * 3) * a1)
        T(c, "105.70", "anton", 150, 280, 680, (190, 180, 210), None, clamp(k * 3) * a1, 1.5 - 0.5 * ease_out(k))
        T(c, "106.59", "anton", 170, W - 280, 680, WHITE, VIOLET, clamp(k * 3) * a1, 1.5 - 0.5 * ease_out(k), glow_r=24)
        k2 = ease_back(prog(b, 1, 0.6))
        T(c, R_TEAM, "anton", fit_size(R_TEAM, "anton", 1000, 100), W / 2, 900, VIOLET, (90, 20, 160), clamp(k2) * a1, 0.8 + 0.2 * k2, glow_r=18)
        T(c, "PROJECTED TO WIN BY", "bebas", 64, W / 2, 1010, WHITE, alpha=clamp(k2) * a1, track=4)
        k3 = prog(b, 2, 0.35)
        T(c, "0.89", "anton", 260, W / 2, 1200, WHITE, VIOLET, clamp(k3 * 3) * a1, 2 - ease_out(k3), glow_r=30)
        T(c, "LESS THAN ONE EXTRA POINT.", "anton", 72, W / 2, 1430, GOLD, (120, 60, 0), ease_out(prog(b, 5, 0.5)) * a1, glow_r=14)
        T(c, "ONE DROPPED PASS FLIPS THE PROPHECY.", "bebas", 60, W / 2, 1530, (220, 210, 240), alpha=ease_out(prog(b, 7.5, 0.5)) * a1, track=2)
    if b >= 12:
        k4 = prog(b, 12, 0.4); fo = 1 - prog(b, 20.5, 1.5)
        T(c, "THE PROPHECY", "anton", 140, W / 2, 780, GOLD, (150, 70, 0), clamp(k4 * 3) * fo, 1.5 - 0.5 * ease_out(k4), glow_r=26)
        T(c, "IS NOT YET WRITTEN.", "anton", 104, W / 2, 940, WHITE, (150, 70, 0), clamp(k4 * 3) * fo, 1.5 - 0.5 * ease_out(k4), glow_r=20)
        k5 = ease_out(prog(b, 15, 0.6))
        put(c, avatar("L", 150, True), W / 2 - 140, 1180, k5 * fo); put(c, avatar("R", 150, True), W / 2 + 140, 1180, k5 * fo)
        T(c, "VS", "anton", 70, W / 2, 1180, (255, 90, 90), None, k5 * fo)
        T(c, "WEEK 6 · LET THE BATTLE BEGIN", "bebas", 64, W / 2, 1360, (220, 210, 240), alpha=ease_out(prog(b, 16, 0.6)) * fo, track=4)

IMPACTS = [6 * BEAT, 12 * BEAT, 14 * BEAT] + [impact_time(i) for i in range(N)] + [VERDICT0 * BEAT, (VERDICT0 + 12) * BEAT]

def frame(fi):
    t = fi / FPS
    c = BG.copy()
    draw_particles(c, t)
    b = t / BEAT
    if b < INTRO_BEATS: intro(c, t)
    elif b < TALLY0:
        i = int((b - DUEL0) // DUEL_BEATS)
        duel(c, t, i)
        ta = ease_out(prog(b, DUEL0, 0.8)) * (1 - ease_out(prog(b, TALLY0 - 0.6, 0.6)))
        tally(c, t, i, ta)
    elif b < VERDICT0: recap(c, t)
    else: verdict(c, t)
    # shake + flash
    amp = 0; flash = 0
    for ti in IMPACTS:
        if 0 <= t - ti < 1.0:
            amp += 22 * math.exp(-(t - ti) * 7); flash += 0.55 * math.exp(-(t - ti) * 12)
    img = c.convert("RGB")
    if amp > 0.5:
        m = 30; dx = amp * math.sin(t * 91.0); dy = amp * math.cos(t * 77.0)
        img = img.crop((m + dx, m + dy, W - m + dx, H - m + dy)).resize((W, H), Image.BILINEAR)
    if flash > 0.01:
        img = Image.blend(img, Image.new("RGB", (W, H), (255, 240, 220)), min(flash, 0.7))
    # fade in from black / out to black
    fade = min(clamp(t / 0.4), clamp((DURATION - t) / 1.2))
    if fade < 1: img = Image.blend(Image.new("RGB", (W, H)), img, fade)
    return img.tobytes()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "stills":
        for s in sys.argv[2:]:
            t = float(s); Image.frombytes("RGB", (W, H), frame(int(t * FPS))).save(f"still_{s}.png")
        sys.exit()
    nframes = int(DURATION * FPS)
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-i", "music.wav", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
                           "matchup_battle.mp4"], stdin=subprocess.PIPE)
    with Pool(4) as pool:
        for k, buf in enumerate(pool.imap(frame, range(nframes), chunksize=8)):
            ff.stdin.write(buf)
            if k % 300 == 0: print(k, "/", nframes, flush=True)
    ff.stdin.close(); ff.wait(); print("done")
