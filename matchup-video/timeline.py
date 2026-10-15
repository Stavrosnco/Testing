BPM = 96
BEAT = 60 / BPM
FPS = 30
W, H = 1080, 1920

INTRO_BEATS = 16
DUEL_BEATS = 10
IMPACT_BEAT = 4          # within a duel
N = 9
GEN_BEATS = 24
GEN0 = INTRO_BEATS
DUEL0 = GEN0 + GEN_BEATS
TALLY0 = DUEL0 + N * DUEL_BEATS        # 106
VERDICT0 = TALLY0 + 12                 # 118
END_BEAT = VERDICT0 + 22               # 140
DURATION = END_BEAT * BEAT + 1.5

L_TEAM, R_TEAM = "LISAN AL-GIBBS", "FLOWERSFORALGERNON"
L_MGR, R_MGR = "SHANE", "MITCH"

# label, left (value, delta), right (value, delta), edge: -1 left, 1 right, 0 none
STATS = [
    ("LEVEL", ("GOLD", None), ("GOLD", None), 0),
    ("RATING", ("709", "+23"), ("716", "-13"), 1),
    ("RECORD", ("405-378-3", None), ("12-10-0", None), 1),
    ("WIN %", (".517", None), (".545", None), 1),
    ("TROPHIES", ("18", None), ("1", None), -1),
    ("1ST PLACE", ("7", None), ("1", None), -1),
    ("TOP LEVEL", ("DIAMOND 2X", None), ("GOLD 1X", None), -1),
    ("SINCE", ("2003", None), ("2025", None), 0),
    ("TEAMS", ("52", None), ("2", None), 0),
]
GEN_LINES = [  # (beat within segment, text, side)
    (12, "52 TEAMS. 786 GAMES. 18 TROPHIES.", "L"),
    (16, "VS. A ROOKIE: 22 GAMES, 1 TITLE, HIGHER RATING.", "R"),
    (20, "BUT THE OLD GUARD IS +23 AND RISING.", "X"),
]

# pos, color, left (name, pos-team, pts), right, round title, commentary
DUELS = [
    ("QB", (90, 160, 255), ("J. ALLEN", "QB · BUF", 26.37), ("B. PURDY", "QB · SF", 20.89),
     "CLASH OF THE ARMS", "The Bills' warlord draws first blood."),
    ("RB", (60, 210, 190), ("J. WARREN", "RB · PIT", 14.23), ("J. TAYLOR", "RB · IND", 17.95),
     "THE GROUND WAR", "Jonathan Taylor tramples back. The gap shrinks."),
    ("RB", (60, 210, 190), ("D. PIERCE", "RB · PHI", 8.18), ("O. HAMPTON", "RB · LAC", 7.60),
     "TRENCH WARFARE", "A knife fight in the mud. Pierce by a hair."),
    ("WR", (255, 140, 60), ("M. GOLDEN", "WR · GB", 12.43), ("G. PICKENS", "WR · DAL", 12.18),
     "DUEL ON THE FLANK", "Golden edges Pickens. High tide for the Gibbs army."),
    ("WR", (255, 140, 60), ("K. SHAKIR", "WR · BUF", 8.03), ("Z. FLOWERS", "WR · BAL", 13.34),
     "THE FLOWERS BLOOM", "A 5-point swing. The tide turns for Algernon."),
    ("TE", (255, 110, 180), ("I. LIKELY", "TE · NYG", 10.60), ("T. KRAFT", "TE · GB", 10.15),
     "BATTLE OF THE BIG MEN", "Likely wins the round... but the deficit holds."),
    ("WRT", (255, 120, 120), ("T. KELCE", "TE · KC", 9.59), ("T. MCLAURIN", "WR · WAS", 9.83),
     "THE FLEX GAMBIT", "The legend falls to Terry by a quarter point."),
    ("K", (180, 230, 60), ("B. GRUPE", "K · LAR", 9.09), ("J. MYERS", "K · SEA", 7.95),
     "THE SIEGE ENGINES", "Grupe's leg keeps the prophecy alive."),
    ("DEF", (245, 205, 50), ("COLTS", "DEF · IND", 7.18), ("SEAHAWKS", "DEF · SEA", 6.70),
     "THE LAST WALL", "The Colts hold the line... but it's not enough."),
]

def cum():
    l = r = 0.0
    out = []
    for d in DUELS:
        l += d[2][2]; r += d[3][2]
        out.append((round(l, 2), round(r, 2)))
    return out

CUM = cum()
assert CUM[-1] == (105.70, 106.59), CUM[-1]

def duel_start(i):
    return (DUEL0 + i * DUEL_BEATS) * BEAT

def impact_time(i):
    return duel_start(i) + IMPACT_BEAT * BEAT
