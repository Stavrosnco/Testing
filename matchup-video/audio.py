import numpy as np, wave
from timeline import *

SR = 44100
n = int(DURATION * SR)
L = np.zeros(n); R = np.zeros(n)
rng = np.random.default_rng(7)

def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= n: return
    sig = sig[: n - i]
    L[i:i + len(sig)] += sig * gain * (1 - pan) ** 0.5
    R[i:i + len(sig)] += sig * gain * (1 + pan) ** 0.5

def tt(d): return np.arange(int(d * SR)) / SR

def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    # vectorised one-pole via lfilter-like recursion (scipy-free)
    y = np.empty_like(x); acc = 0.0
    for k in range(len(x)):
        acc = (1 - a) * x[k] + a * acc; y[k] = acc
    return y

def fft_lowpass(x, fc, order=2):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X /= np.sqrt(1 + (f / fc) ** (2 * order))
    return np.fft.irfft(X, len(x))

def saw(f, t, detune=(0.997, 1.0, 1.004)):
    return sum(2 * ((f * d * t + rng.random()) % 1) - 1 for d in detune) / len(detune)

def taiko(big=1.0):
    t = tt(1.4)
    f = 45 + 90 * np.exp(-t * 18)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (3.5 / big))
    slap = fft_lowpass(rng.standard_normal(len(t)), 900) * np.exp(-t * 40) * 0.6
    return np.tanh((body + slap) * 1.6)

def snare_roll_hit():
    t = tt(0.25)
    return fft_lowpass(rng.standard_normal(len(t)), 3000) * np.exp(-t * 25)

def impact():
    t = tt(4.0)
    f = 30 + 120 * np.exp(-t * 10)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.6)
    crash = fft_lowpass(rng.standard_normal(len(t)), 5000) * np.exp(-t * 2.2) * 0.35
    return np.tanh((boom * 1.4 + crash) * 1.3)

def whoosh(d=0.8, up=True):
    t = tt(d)
    noise = rng.standard_normal(len(t))
    env = (t / d) ** 2 if up else np.exp(-t * 6)
    lo = fft_lowpass(noise, 1200); hi = fft_lowpass(noise, 6000)
    mix = t / d if up else 1 - t / d
    return (lo * (1 - mix) + hi * mix) * env * 0.5

def riser(d):
    t = tt(d)
    f = 100 * (8 ** (t / d))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.15
    return (tone + whoosh(d)[: len(t)]) * (t / d) ** 1.5

NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)
CHORDS = {"Dm": [38, 50, 53, 57, 62], "Bb": [34, 46, 50, 53, 58], "F": [41, 48, 53, 57, 60],
          "C": [36, 48, 52, 55, 60], "A": [33, 45, 49, 52, 57]}

def pad(chord, d, fc=900, gain=1.0):
    t = tt(d)
    s = sum(saw(NOTE(m), t) for m in CHORDS[chord]) / 5
    env = np.minimum(1, t / 0.4) * np.minimum(1, (d - t) / 0.3).clip(0)
    return fft_lowpass(s, fc) * env * gain

def brass(chord, d=1.6):
    t = tt(d)
    notes = CHORDS[chord][1:]
    s = sum(saw(NOTE(m + 12), t, (0.995, 1.005)) for m in notes) / 4
    env = np.minimum(1, t / 0.03) * np.exp(-t * 1.8)
    return np.tanh(fft_lowpass(s, 2500) * env * 2) * 0.6

def ostinato(chord, d, root_shift=0):
    t = tt(d); out = np.zeros(len(t))
    step = BEAT / 2; seq = [0, 2, 1, 2]  # indices into chord tones above root
    tones = CHORDS[chord][1:4]
    k = 0
    while k * step < d:
        i0 = int(k * step * SR); seg = tt(step * 0.95)
        f = NOTE(tones[seq[k % 4]] + 12 + root_shift)
        note = saw(f, seg, (1.0, 1.003)) * np.exp(-seg * 7)
        out[i0:i0 + len(seg)] += note[: len(out) - i0]
        k += 1
    return fft_lowpass(out, 1800) * 0.35

PROG = ["Dm", "Bb", "F", "C"]

# ---------- INTRO ----------
add(pad("Dm", 16 * BEAT, fc=500, gain=0.5), 0)
add(taiko(1.6), 0, 0.9)
add(whoosh(1.2), 2 * BEAT - 1.2, 0.7, -0.6)
add(whoosh(1.2), 4 * BEAT - 1.2, 0.7, 0.6)
add(taiko(1.2), 2 * BEAT, 0.7, -0.3)
add(taiko(1.2), 4 * BEAT, 0.7, 0.3)
add(impact(), 6 * BEAT, 1.0)
add(brass("Dm", 3.0), 6 * BEAT, 0.7)
for b in range(8, 16):
    add(taiko(0.8), b * BEAT, 0.45 + 0.04 * (b - 8))
    add(ostinato(PROG[(b - 8) // 2 % 4], BEAT), b * BEAT, 0.8)
for k in range(16):  # snare roll into the duels
    add(snare_roll_hit(), (14 + k / 8) * BEAT, 0.15 + 0.02 * k)
add(riser(2 * BEAT), 14 * BEAT, 0.8)

# ---------- DUELS ----------
for i in range(N):
    s = duel_start(i); hit = impact_time(i)
    inten = 0.6 + 0.4 * i / (N - 1)
    add(whoosh(0.5, up=False), s, 0.6)
    for b in range(DUEL_BEATS):
        t0 = s + b * BEAT
        ch = PROG[(b // 2) % 4] if b < IMPACT_BEAT else PROG[((b - IMPACT_BEAT) // 2 + 2) % 4]
        add(ostinato(ch, BEAT), t0, 0.8 + 0.3 * inten)
        add(pad(ch, BEAT * 1.05, fc=700, gain=0.25 * inten), t0)
        add(taiko(1.0 if b % 2 == 0 else 0.6), t0, (0.75 if b % 2 == 0 else 0.4) * inten)
        if i >= 4:
            add(taiko(0.5), t0 + BEAT / 2, 0.3 * inten, 0.4 if b % 2 else -0.4)
    # build into the hit
    add(riser(IMPACT_BEAT * BEAT - 0.3), s + 0.3, 0.35)
    add(impact(), hit, 0.9)
    add(brass("Dm" if DUELS[i][2][2] > DUELS[i][3][2] else "Bb"), hit, 0.75)

# ---------- TALLY ----------
t0 = TALLY0 * BEAT
add(pad("A", 12 * BEAT, fc=1200, gain=0.45), t0)
for b in range(12):
    add(taiko(1.0), t0 + b * BEAT, 0.5 + 0.03 * b)
for k in range(48):
    add(snare_roll_hit(), t0 + 6 * BEAT + k * (6 * BEAT / 48), 0.1 + 0.006 * k)
add(riser(6 * BEAT), t0 + 6 * BEAT, 0.9)

# ---------- VERDICT ----------
t0 = VERDICT0 * BEAT
add(impact(), t0, 1.2)
add(brass("Bb", 3.5), t0, 0.9)
add(pad("Bb", 8 * BEAT, fc=1400, gain=0.6), t0)
add(pad("C", 4 * BEAT, fc=1400, gain=0.6), t0 + 8 * BEAT)
for b in range(0, 12, 2):
    add(taiko(1.2), t0 + b * BEAT, 0.5)
add(riser(2 * BEAT), t0 + 10 * BEAT, 0.6)
add(impact(), t0 + 12 * BEAT, 1.1)
add(brass("Dm", 4), t0 + 12 * BEAT, 0.9)
add(pad("Dm", 10 * BEAT + 1.5, fc=900, gain=0.6), t0 + 12 * BEAT)

# ---------- MIX ----------
def reverb(x, secs=2.2, wet=0.22):
    m = int(secs * SR); ir = rng.standard_normal(m) * np.exp(-np.arange(m) / SR * 3.0)
    ir = fft_lowpass(ir, 4000); ir /= np.sqrt((ir ** 2).sum())
    N2 = 1 << int(np.ceil(np.log2(len(x) + m)))
    y = np.fft.irfft(np.fft.rfft(x, N2) * np.fft.rfft(ir, N2), N2)[: len(x)]
    return x + wet * y

L = reverb(L); R = reverb(R)
fade = np.ones(n); fo = int(2.0 * SR); fade[-fo:] = np.linspace(1, 0, fo)
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
L = np.tanh(L / peak * 1.4) * 0.92; R = np.tanh(R / peak * 1.4) * 0.92
data = (np.stack([L, R], 1) * 32767).astype(np.int16)
with wave.open("music.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print("ok", DURATION)
