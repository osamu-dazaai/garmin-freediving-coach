#!/usr/bin/env python3
"""
ApneaOS — Freediving Dashboard
"""

import streamlit as st
import sqlite3
import pandas as pd
import json
import math
import time as time_module
from pathlib import Path
import sys
import subprocess

sys.path.insert(0, str(Path(__file__).parent.parent))

DB_PATH = Path(__file__).parent.parent / 'data' / 'freediving.db'

st.set_page_config(
    page_title="ApneaOS",
    page_icon="🤿",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Global CSS ──────────────────────────────────────────────────────────────
# st.html() renders directly in the page (not iframe) in Streamlit ≥1.31
st.html("""<script>
(function(){
  function apneaGo(href){
    var el=document.querySelector('.apnea');
    if(el){el.style.transition='opacity 0.12s';el.style.opacity='0';}
    setTimeout(function(){window.location.assign(href);},120);
  }
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(!a)return;
    var h=a.getAttribute('href');
    // Intercept relative links and same-host links (works with any IP/domain)
    var sameHost = a.hostname && a.hostname===window.location.hostname;
    if(h&&(h.startsWith('?')||sameHost)){
      e.preventDefault();apneaGo(a.href);
    }
  },true);
})();
</script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Be+Vietnam+Pro:wght@300;400;500;600&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap');

/* ── Streamlit chrome removal ── */
[data-testid="stHeader"],
[data-testid="stToolbar"],
[data-testid="stDecoration"],
[data-testid="stStatusWidget"],
[data-testid="stSidebar"],
[data-testid="collapsedControl"],
[data-testid="stFooter"],
footer, #MainMenu, .stDeployButton { display: none !important; }

/* ── Layout reset ── */
[data-testid="stAppViewContainer"] { background: #060e1b !important; }
.block-container, [data-testid="block-container"] {
  padding: 0 !important; max-width: 100% !important;
}
[data-testid="stVerticalBlock"] { gap: 0 !important; }
[data-testid="stVerticalBlockBorderWrapper"] { border: none !important; background: transparent !important; }
.stApp, html, body { background: #060e1b !important; }
[data-testid="stMarkdown"] { margin: 0 !important; padding: 0 !important; }
[data-testid="element-container"] { margin: 0 !important; padding: 0 !important; }

/* ── Material icons ── */
.mi {
  font-family: 'Material Symbols Outlined';
  font-variation-settings: 'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;
  display: inline-block; line-height: 1; vertical-align: middle;
}
.mi.fill { font-variation-settings: 'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24; }

/* ── App shell ── */
.apnea {
  background: #060e1b;
  color: #e0e8fa;
  font-family: 'Be Vietnam Pro', sans-serif;
  min-height: 100vh;
  padding-bottom: 88px;
  animation: apnea-in 0.18s ease;
}
@keyframes apnea-in { from { opacity: 0; } to { opacity: 1; } }

/* ── Topbar ── */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; height: 64px;
  background: #060e1b;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  position: sticky; top: 0; z-index: 100;
  max-width: 100%;
}
.topbar-logo {
  display: flex; align-items: center; gap: 8px;
  font-family: 'Space Grotesk',sans-serif; font-weight: 700;
  font-size: 12px; color: #00F0FF; text-transform: uppercase; letter-spacing: -0.03em;
}
.topbar-title {
  font-family: 'Space Grotesk',sans-serif; font-weight: 700;
  font-size: 11px; color: #00F0FF; text-transform: uppercase; letter-spacing: 0.2em;
}

/* ── Content wrapper (responsive) ── */
.content {
  max-width: 480px; margin: 0 auto; padding: 0;
}
@media (min-width: 768px) {
  .content { max-width: 640px; }
}
@media (min-width: 1024px) {
  .content { max-width: 1040px; }
  .dash-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 0; align-items: start;
  }
  .dcard-details { grid-template-columns: repeat(6,1fr) !important; }
}
@media (min-width: 1400px) {
  .content { max-width: 1200px; }
  .dash-grid { grid-template-columns: 5fr 7fr; }
}

/* ── Bottom nav ── */
.bnav {
  position: fixed; bottom: 0; left: 0; width: 100%; z-index: 200;
  background: #0a1421; border-top: 1px solid rgba(255,255,255,0.05);
  box-shadow: 0 -4px 20px rgba(0,240,255,0.07); border-radius: 12px 12px 0 0;
}
.bnav-inner {
  max-width: 480px; margin: 0 auto; display: flex;
  justify-content: space-around; align-items: center; height: 80px; padding: 0 8px;
}
@media (min-width: 768px) { .bnav-inner { max-width: 600px; } }
@media (min-width: 1024px) { .bnav-inner { max-width: 720px; } }
.ni {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  text-decoration: none !important; color: #64748b; transition: color 0.15s;
  padding: 8px 16px; -webkit-tap-highlight-color: transparent;
}
.ni:hover { color: #8ff5ff; text-decoration: none; }
.ni.on { color: #00F0FF; filter: drop-shadow(0 0 8px rgba(0,240,255,0.5)); }
.ni-icon { font-size: 24px; line-height: 1; }
.ni-lbl {
  font-family: 'Space Grotesk',sans-serif;
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
}

/* ── Directive card ── */
.directive {
  margin: 16px 24px; padding: 18px 20px;
  background: #0f1a29; border-left: 2px solid #00F0FF; border-radius: 2px;
}
.dtag {
  font-family: 'Space Grotesk',sans-serif; font-size: 10px; font-weight: 700;
  color: #a3abbc; text-transform: uppercase; letter-spacing: 0.2em;
  display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
}
.dbody { color: #e0e8fa; font-size: 14px; line-height: 1.6; }

/* ── Gauge ── */
.gauge-wrap {
  display: flex; justify-content: center; padding: 8px 0 4px;
  background: radial-gradient(circle at 50% 40%, #152030 0%, #060e1b 55%);
}
.gauge-svg { width: 200px; height: 200px; }
@media (min-width: 768px) { .gauge-svg { width: 220px; height: 220px; } }
@media (min-width: 1024px) { .gauge-svg { width: 260px; height: 260px; } }

/* ── Metric cards ── */
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 24px; }
.mc {
  background: rgba(57,71,95,0.22); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 2px; padding: 14px 16px;
}
.mc-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.mc-icon { font-size: 18px; }
.mc-lbl { font-family: 'Space Grotesk',sans-serif; font-size: 9px; font-weight: 700; color: #a3abbc; text-transform: uppercase; letter-spacing: 0.2em; }
.mc-val { display: flex; align-items: baseline; gap: 4px; margin-bottom: 8px; }
.mc-num { font-family: 'Space Grotesk',sans-serif; font-size: 26px; color: #e0e8fa; }
.mc-unit { font-family: 'Space Grotesk',sans-serif; font-size: 10px; color: #6d7685; text-transform: uppercase; }
.mbar-bg { height: 3px; background: #060e1b; border-radius: 1px; overflow: hidden; }
.mbar { height: 100%; border-radius: 1px; }

/* ── Section heading ── */
.sh {
  font-family: 'Space Grotesk',sans-serif; font-size: 10px; font-weight: 700;
  color: #a3abbc; text-transform: uppercase; letter-spacing: 0.2em;
  padding: 20px 24px 10px;
}

/* ── Dive cards ── */
.dcard {
  margin: 0 24px 12px; padding: 18px 20px;
  background: rgba(57,71,95,0.18); border-left: 2px solid rgba(0,240,255,0.2);
  border-radius: 2px; position: relative; overflow: hidden;
}
.dcard.pb { border-left-color: #00F0FF; }
.dcard-r1 { display: flex; justify-content: space-between; margin-bottom: 12px; }
.dl { font-family: 'Space Grotesk',sans-serif; font-size: 9px; font-weight: 700; color: #6d7685; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 3px; }
.dv { font-family: 'Space Grotesk',sans-serif; font-size: 16px; font-weight: 700; color: #00deec; }
.dvr { font-family: 'Space Grotesk',sans-serif; font-size: 13px; color: #e0e8fa; text-align: right; }
.dcard-r2 { display: flex; align-items: flex-end; justify-content: space-between; }
.ddepth { font-family: 'Space Grotesk',sans-serif; font-size: 40px; font-weight: 700; color: #00F0FF; line-height: 1; }
.ddepth-u { font-family: 'Space Grotesk',sans-serif; font-size: 13px; font-weight: 700; color: #00deec; margin-left: 2px; }
.dtime { font-family: 'Space Grotesk',sans-serif; font-size: 20px; color: #e0e8fa; }
.dtime-u { font-family: 'Space Grotesk',sans-serif; font-size: 10px; font-weight: 700; color: #6d7685; }
.pb-badge {
  position: absolute; top: 0; right: 0;
  background: #00F0FF; color: #003f43;
  font-family: 'Space Grotesk',sans-serif; font-size: 8px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  padding: 4px 10px; border-radius: 0 2px 0 4px;
}
.dcard-details {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;
  margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.05);
}
.dd-l { font-family: 'Space Grotesk',sans-serif; font-size: 9px; color: #6d7685; text-transform: uppercase; letter-spacing: 0.1em; display: block; margin-bottom: 2px; }
.dd-v { font-family: 'Space Grotesk',sans-serif; font-size: 15px; color: #e0e8fa; }

/* ── Month heading ── */
.mh { display: flex; align-items: baseline; justify-content: space-between; padding: 16px 24px 10px; }
.mh-t { font-family: 'Space Grotesk',sans-serif; font-size: 22px; font-weight: 700; color: #e0e8fa; letter-spacing: -0.02em; }
.mh-c { font-family: 'Space Grotesk',sans-serif; font-size: 10px; font-weight: 700; color: #6d7685; letter-spacing: 0.15em; text-transform: uppercase; }

/* ── Protocol cards ── */
.pcard {
  margin: 0 24px 16px; padding: 22px;
  background: rgba(57,71,95,0.18); border-left: 4px solid; border-radius: 2px;
}
.pt { font-family: 'Space Grotesk',sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 4px; }
.pn { font-family: 'Space Grotesk',sans-serif; font-size: 20px; font-weight: 700; color: #e0e8fa; margin-bottom: 18px; }
.pstats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.ps-l { font-family: 'Space Grotesk',sans-serif; font-size: 10px; color: #6d7685; text-transform: uppercase; letter-spacing: 0.1em; display: block; margin-bottom: 2px; }
.ps-v { font-family: 'Space Grotesk',sans-serif; font-size: 18px; color: #e0e8fa; }
.ps-u { font-family: 'Space Grotesk',sans-serif; font-size: 10px; color: #a3abbc; text-transform: uppercase; margin-left: 4px; }
.pfoot { display: flex; align-items: center; margin-top: 18px; }
.pbar-bg { flex: 1; height: 3px; background: #0f1a29; border-radius: 2px; overflow: hidden; margin-right: 12px; }
.pbar { height: 100%; border-radius: 2px; }

/* ── Stats grid (profile) ── */
.sg { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 28px; }
.sb { background: #0f1a29; border-radius: 2px; padding: 14px; text-align: center; }
.sb-n { font-family: 'Space Grotesk',sans-serif; font-size: 26px; font-weight: 700; color: #00F0FF; }
.sb-l { font-family: 'Space Grotesk',sans-serif; font-size: 9px; color: #6d7685; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 4px; display: block; }

/* ── Filter bar ── */
.fbar { display: flex; gap: 8px; padding: 14px 24px; overflow-x: auto; scrollbar-width: none; }
.fbar::-webkit-scrollbar { display: none; }
.fb {
  display: inline-block; padding: 7px 18px; white-space: nowrap;
  font-family: 'Space Grotesk',sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; border-radius: 2px;
  text-decoration: none !important;
}
.fb.on { background: #00F0FF; color: #003f43; }
.fb.off { background: #152030; color: #a3abbc; border: 1px solid rgba(0,240,255,0.15); }

/* ── Streamlit button overrides (sync only) ── */
[data-testid="stButton"] > button {
  background: #00F0FF !important; color: #003f43 !important;
  border: none !important; border-radius: 2px !important;
  font-family: 'Space Grotesk',sans-serif !important; font-weight: 700 !important;
  letter-spacing: 0.1em !important; text-transform: uppercase !important; font-size: 12px !important;
}
[data-testid="stButton"] > button:hover { filter: brightness(1.1) !important; }
</style>""")


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_db():
    return sqlite3.connect(str(DB_PATH))

@st.cache_data(ttl=60)
def load_health():
    try:
        conn = get_db(); df = pd.read_sql_query("SELECT * FROM health_metrics ORDER BY date DESC", conn); conn.close(); return df
    except Exception: return pd.DataFrame()

@st.cache_data(ttl=60)
def load_dives():
    try:
        conn = get_db(); df = pd.read_sql_query("SELECT * FROM activities WHERE activity_type='apnea_diving' ORDER BY start_time DESC", conn); conn.close(); return df
    except Exception: return pd.DataFrame()

def meta(row):
    try: return json.loads(row['metadata']) if pd.notna(row['metadata']) else {}
    except: return {}

def safe_f(v): return float(v) if (v is not None and pd.notna(v) and v != '') else None

def calc_readiness(row):
    hrv   = safe_f(row.get('hrv_avg'))
    sleep = safe_f(row.get('sleep_score'))
    bb    = safe_f(row.get('body_battery_charged'))
    stress = safe_f(row.get('stress_avg'))
    score  = 0.0
    score += (min(100.0, hrv / 80 * 100) if hrv else 60.0) * 0.4
    score += (sleep if sleep else 65.0) * 0.3
    score += (bb if bb else 70.0) * 0.2
    score += (max(0.0, 100 - stress) if stress else 65.0) * 0.1
    return round(score)

def gauge_svg(score):
    r = 42; circ = 2 * math.pi * r
    filled = circ * (score / 100); empty = circ - filled
    color = "#00F0FF" if score >= 80 else "#65afff" if score >= 60 else "#ff716c"
    label = "OPTIMAL" if score >= 80 else "MODERATE" if score >= 60 else "LOW"
    arrow = "▲" if score >= 60 else "▼"
    ticks = "".join(
        f'<line x1="{50+42*math.sin(math.radians(d)):.1f}" y1="{50-42*math.cos(math.radians(d)):.1f}" '
        f'x2="{50+38*math.sin(math.radians(d)):.1f}" y2="{50-38*math.cos(math.radians(d)):.1f}" '
        f'stroke="rgba(255,255,255,0.12)" stroke-width="1"/>'
        for d in range(0, 360, 45)
    )
    return f"""<div class="gauge-wrap">
  <svg class="gauge-svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="{r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="2.5" transform="rotate(-90 50 50)"/>
    <circle cx="50" cy="50" r="{r}" fill="none" stroke="{color}" stroke-width="3"
      stroke-dasharray="{filled:.2f} {empty:.2f}" stroke-linecap="square" transform="rotate(-90 50 50)"
      style="filter:drop-shadow(0 0 10px {color}80)"/>
    {ticks}
    <text x="50" y="41" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="6.5" font-weight="700" letter-spacing="2" fill="#a3abbc">READINESS</text>
    <text x="50" y="59" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="24" font-weight="300" fill="{color}">{score}</text>
    <text x="50" y="70" text-anchor="middle" font-family="Space Grotesk,sans-serif" font-size="5.5" font-weight="700" letter-spacing="1.5" fill="{color}">{arrow} {label}</text>
  </svg>
</div>"""

def bnav(page):
    items = [("dashboard","speed","Dashboard"),("log","database","Log"),("protocol","timer","Protocol"),("profile","person","Profile")]
    links = ""
    for key, icon, lbl in items:
        cls = "ni on" if page == key else "ni"
        fill = "fill" if page == key else ""
        links += f'<a href="?page={key}" target="_self" class="{cls}"><span class="mi {fill} ni-icon">{icon}</span><span class="ni-lbl">{lbl}</span></a>'
    return f'<nav class="bnav"><div class="bnav-inner">{links}</div></nav>'

def topbar_html(title="", logo=True):
    logo_part = '<div class="topbar-logo"><span class="mi" style="color:#00F0FF;font-size:18px">terminal</span>NAVIGATOR_01</div>' if logo else '<div></div>'
    right = (
        '<div style="display:flex;align-items:center;gap:12px">'
        '<a href="?action=sync" target="_self" title="Sync Garmin" style="color:#00F0FF;text-decoration:none;opacity:0.8">'
        '<span class="mi" style="font-size:20px">sync</span></a>'
        '<a href="?page=profile" target="_self" style="color:#00F0FF;text-decoration:none">'
        '<span class="mi" style="font-size:20px">settings</span></a>'
        '</div>'
    )
    return f'<header class="topbar">{logo_part}<span class="topbar-title">{title}</span>{right}</header>'

def mcard(icon, label, val, unit, color, pct):
    disp = f"{val:.0f}" if val is not None else "—"
    pct = min(100, max(0, pct))
    return f"""<div class="mc">
  <div class="mc-top"><span class="mi mc-icon" style="color:{color}">{icon}</span><span class="mc-lbl">{label}</span></div>
  <div class="mc-val"><span class="mc-num">{disp}</span><span class="mc-unit">{unit}</span></div>
  <div class="mbar-bg"><div class="mbar" style="width:{pct}%;background:{color}"></div></div>
</div>"""

def dive_card_html(row, is_pb=False):
    m       = meta(row)
    depth   = m.get('maxDepth', 0) / 100
    dc      = m.get('diveCount', 0)
    dur_s   = float(row.get('duration', 0) or 0)
    dur_m   = int(dur_s // 60); dur_ss = int(dur_s % 60)
    loc     = m.get('locationName', 'Unknown').upper()
    dt      = pd.to_datetime(row['start_time'])
    date_s  = dt.strftime('%b %d, %H:%M').upper()
    bt      = m.get('bottomTime', 0)
    avg_d   = m.get('avgDepth', 0) / 100
    avg_hr  = row.get('avg_hr', 0) or 0
    max_hr  = row.get('max_hr', 0) or 0
    wtemp   = m.get('minTemperature', 0)
    grade   = "A+" if depth >= 4.5 else "A" if depth >= 3.5 else "B" if depth >= 2.5 else "C"
    pb_html = '<div class="pb-badge">PERSONAL BEST</div>' if is_pb else ''
    cls     = "dcard pb" if is_pb else "dcard"
    return f"""<div class="{cls}">
  {pb_html}
  <div class="dcard-r1">
    <div><div class="dl">Location</div><div class="dv">{loc}</div></div>
    <div><div class="dl" style="text-align:right">Date</div><div class="dvr">{date_s}</div></div>
  </div>
  <div class="dcard-r2">
    <div><span class="ddepth">{depth:.1f}</span><span class="ddepth-u">M</span></div>
    <div style="text-align:right">
      <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;margin-bottom:4px">
        <span class="mi" style="color:#65afff;font-size:16px">timer</span>
        <span class="dtime">{dur_m}:{dur_ss:02d}</span><span class="dtime-u">M:S</span>
      </div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:11px;color:#a3abbc">{dc} DIVES · GRADE {grade}</div>
    </div>
  </div>
  <div class="dcard-details">
    <div><span class="dd-l">Avg Depth</span><span class="dd-v">{avg_d:.1f}m</span></div>
    <div><span class="dd-l">Avg HR</span><span class="dd-v">{avg_hr:.0f}</span></div>
    <div><span class="dd-l">Bottom</span><span class="dd-v">{bt:.0f}s</span></div>
    <div><span class="dd-l">Temp</span><span class="dd-v">{wtemp:.0f}°C</span></div>
    <div><span class="dd-l">Max HR</span><span class="dd-v">{max_hr:.0f}</span></div>
    <div><span class="dd-l">Dives</span><span class="dd-v">{dc}</span></div>
  </div>
</div>"""


# ── Navigation ────────────────────────────────────────────────────────────────

def get_page():
    if 'page' not in st.session_state:
        st.session_state.page = st.query_params.get("page", "dashboard")
    # Sync query params → session state when URL changes
    qp = st.query_params.get("page", "dashboard")
    if qp != st.session_state.page:
        st.session_state.page = qp
    return st.session_state.page


# ── Screens ──────────────────────────────────────────────────────────────────

def screen_dashboard():
    health_df = load_health()
    dives_df  = load_dives()

    score = 72
    hrv = sleep = bb = rhr = None
    if not health_df.empty:
        row  = health_df.iloc[0].to_dict()
        score = calc_readiness(row)
        hrv  = safe_f(row.get('hrv_avg'));   sleep = safe_f(row.get('sleep_score'))
        bb   = safe_f(row.get('body_battery_charged')); rhr = safe_f(row.get('resting_hr'))

    if score >= 80: directive = "Optimal recovery. Proceed with <b>Max Depth CWT protocol</b>."
    elif score >= 60: directive = "Moderate readiness. <b>CO₂ table</b> or dynamic pool work recommended."
    else: directive = "Low readiness. <b>Rest day</b> recommended — breathwork only."

    cards = (
        mcard("monitor_heart", "HRV",         hrv,   "ms",    "#65afff", (hrv/80*100) if hrv else 50) +
        mcard("bedtime",       "Sleep",        sleep, "Score", "#00F0FF", sleep        if sleep else 65) +
        mcard("battery_full",  "Body Battery", bb,    "%",     "#00F0FF", bb           if bb else 70) +
        mcard("favorite",      "RHR",          rhr,   "bpm",   "#ff716c", max(0,100-(rhr-40)/40*100) if rhr else 60)
    )

    # Dive cards (top 3)
    dive_html = ""
    if not dives_df.empty:
        pb_depth = max((meta(r).get('maxDepth',0)/100 for _,r in dives_df.iterrows()), default=0)
        for _, row in dives_df.head(3).iterrows():
            d = meta(row).get('maxDepth',0)/100
            dive_html += dive_card_html(row, is_pb=(d > 0 and abs(d - pb_depth) < 0.05))
    else:
        dive_html = '<div style="padding:24px;color:#6d7685;font-size:14px">No dive data yet. Sync your Garmin watch.</div>'

    html = f"""<div class="apnea">
{topbar_html("SESSION_ID_0824")}
<div class="content">
  <div class="dash-grid">
    <div class="dash-left">
      <div class="directive">
        <div class="dtag"><span class="mi" style="font-size:13px;color:#00F0FF">terminal</span>Today's Directive</div>
        <div class="dbody">{directive}</div>
      </div>
      {gauge_svg(score)}
    </div>
    <div class="dash-right">
      <div class="metrics" style="padding-top:12px">{cards}</div>
      <div class="sh">Recent Sessions</div>
      {dive_html}
    </div>
  </div>
</div>
{bnav("dashboard")}
</div>"""
    st.markdown(html, unsafe_allow_html=True)


def screen_log():
    dives_df = load_dives()
    filt = st.query_params.get("log_filter", "ALL")
    periods = [("ALL","All Time"), ("1M","This Month"), ("3M","Last 3 Months"), ("DEEP","5m+ Dives")]

    filter_links = "".join(
        f'<a href="?page=log&log_filter={k}" target="_self" class="fb {"on" if k==filt else "off"}">{v}</a>'
        for k, v in periods
    )

    cards_html = ""
    if not dives_df.empty:
        dives_df = dives_df.copy()
        dives_df['_dt'] = pd.to_datetime(dives_df['start_time'])
        now = pd.Timestamp.now()
        if filt == "1M":
            dives_df = dives_df[dives_df['_dt'].dt.month == now.month]
        elif filt == "3M":
            dives_df = dives_df[dives_df['_dt'] >= now - pd.Timedelta(days=90)]
        elif filt == "DEEP":
            dives_df = dives_df[dives_df.apply(lambda r: meta(r).get('maxDepth',0)/100 >= 4.0, axis=1)]

        if dives_df.empty:
            cards_html = '<div style="padding:48px 24px;text-align:center;color:#6d7685">No sessions match this filter.</div>'
        else:
            pb_depth = max((meta(r).get('maxDepth',0)/100 for _,r in dives_df.iterrows()), default=0)
            dives_df['_month'] = dives_df['_dt'].dt.strftime('%B %Y')
            cur_month = None
            for _, row in dives_df.iterrows():
                month = row['_month']
                if month != cur_month:
                    cnt = len(dives_df[dives_df['_month'] == month])
                    cards_html += f'<div class="mh"><span class="mh-t">{month}</span><span class="mh-c">{cnt} SESSION{"S" if cnt!=1 else ""}</span></div>'
                    cur_month = month
                d = meta(row).get('maxDepth',0)/100
                cards_html += dive_card_html(row, is_pb=(d > 0 and abs(d - pb_depth) < 0.05))
    else:
        cards_html = '<div style="padding:48px 24px;text-align:center;color:#6d7685">No dive sessions yet.</div>'

    html = f"""<div class="apnea">
{topbar_html("DIVE LOG")}
<div class="content">
  <div class="fbar">{filter_links}</div>
  {cards_html}
</div>
{bnav("log")}
</div>"""
    st.markdown(html, unsafe_allow_html=True)


def build_protocols(dives_df):
    """Generate CO2/O2/Pyramid protocols calibrated to user's real dive data."""
    def fmt(s): return f"{int(s)//60}:{int(s)%60:02d}"

    # Derive training targets from actual data
    avg_bt = 60.0; max_bt = 90.0; pb_m = 3.0
    if not dives_df.empty:
        bts = [meta(r).get('bottomTime', 0) for _, r in dives_df.head(10).iterrows() if meta(r).get('bottomTime',0) > 0]
        depths = [meta(r).get('maxDepth',0)/100 for _, r in dives_df.iterrows()]
        if bts:   avg_bt = sum(bts)/len(bts)
        if bts:   max_bt = max(bts)
        if depths: pb_m = max(depths)

    # CO2 table: 8 sets, target hold ≈ 80% avg bottom time, rest decreasing
    co2_hold = max(60, round(avg_bt * 0.8 / 15) * 15)
    co2_rest_start = max(90, round(avg_bt * 1.2 / 15) * 15)
    co2_rest_min   = 60

    # O2 table: 8 sets, hold increasing toward 90% max_bt, rest constant
    o2_hold_peak = max(90, round(max_bt * 0.85 / 15) * 15)
    o2_rest = max(120, round(avg_bt * 1.5 / 15) * 15)

    # Pyramid: hold goes up then down, peak = personal target
    pyr_peak = max(120, round(max_bt * 0.95 / 15) * 15)

    return [
        {
            "key": "co2",
            "type": "CO₂ Tolerance",
            "name": f"CO2 TABLE · {fmt(co2_hold)} PEAK",
            "desc": f"8 sets · hold {fmt(co2_hold)} · rest {fmt(co2_rest_start)}→{fmt(co2_rest_min)}",
            "detail": f"Decreasing rest from {fmt(co2_rest_start)} to {fmt(co2_rest_min)}. Calibrated to your avg bottom time ({fmt(avg_bt)}).",
            "cycles": 8, "hold": fmt(co2_hold), "rest": fmt(co2_rest_start),
            "icon": "waves", "color": "#00F0FF", "border": "rgba(0,240,255,0.4)",
            "pct": min(100, int(avg_bt / 120 * 100)), "recommended": True,
        },
        {
            "key": "o2",
            "type": "O₂ Adaptation",
            "name": f"O2 TABLE · {fmt(o2_hold_peak)} PEAK",
            "desc": f"8 sets · peak hold {fmt(o2_hold_peak)} · rest {fmt(o2_rest)}",
            "detail": f"Constant rest {fmt(o2_rest)}. Progressive hold toward 85% of your max bottom time ({fmt(max_bt)}).",
            "cycles": 8, "hold": fmt(o2_hold_peak), "rest": fmt(o2_rest),
            "icon": "air", "color": "#65afff", "border": "rgba(101,175,255,0.4)",
            "pct": min(100, int(max_bt / 180 * 100)), "recommended": False,
        },
        {
            "key": "pyramid",
            "type": "Depth Pyramid",
            "name": f"PYRAMID · {pb_m:.1f}m TARGET",
            "desc": f"12 sets · peak {fmt(pyr_peak)} · warm-up to max then back",
            "detail": f"Up/down pyramid peaking at {fmt(pyr_peak)}. Based on your PB depth {pb_m:.1f}m.",
            "cycles": 12, "hold": fmt(pyr_peak), "rest": "2:30",
            "icon": "show_chart", "color": "#ff716c", "border": "rgba(255,113,108,0.4)",
            "pct": 100, "recommended": False,
        },
    ]


def screen_protocol():
    dives_df = load_dives()
    protos   = build_protocols(dives_df)
    sel      = st.query_params.get("proto", None)

    cards_html = ""
    for p in protos:
        rec_badge = '<span style="font-family:\'Space Grotesk\',sans-serif;font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;background:rgba(0,240,255,0.12);color:#00F0FF;padding:3px 8px;border-radius:2px;margin-left:8px">RECOMMENDED</span>' if p.get('recommended') else ''
        cards_html += f"""<div class="pcard" style="border-left-color:{p['border']}">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div style="flex:1">
      <div class="pt" style="color:{p['color']};display:flex;align-items:center">{p['type']}{rec_badge}</div>
      <div class="pn">{p['name']}</div>
      <div class="pstats">
        <div><span class="ps-l">Cycles</span><span class="ps-v">{p['cycles']:02d}<span class="ps-u">Sets</span></span></div>
        <div><span class="ps-l">Peak Hold</span><span class="ps-v">{p['hold']}<span class="ps-u">M:S</span></span></div>
        <div><span class="ps-l">Rest</span><span class="ps-v">{p['rest']}<span class="ps-u">M:S</span></span></div>
      </div>
      <div style="font-family:'Be Vietnam Pro',sans-serif;font-size:12px;color:#6d7685;margin-top:10px;line-height:1.5">{p['detail']}</div>
    </div>
    <div style="background:#0f1a29;width:40px;height:40px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.07);margin-left:12px">
      <span class="mi" style="color:{p['color']}">{p['icon']}</span>
    </div>
  </div>
  <div class="pfoot" style="margin-top:14px">
    <div class="pbar-bg"><div class="pbar" style="width:{p['pct']}%;background:{p['color']}70"></div></div>
    <a href="?page=protocol&proto={p['key']}" target="_self" style="display:flex;align-items:center;gap:4px;text-decoration:none;color:{p['color']};font-family:\'Space Grotesk\',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;white-space:nowrap;margin-left:12px">START<span class="mi" style="font-size:16px">play_arrow</span></a>
  </div>
</div>"""

    html = f"""<div class="apnea">
{topbar_html("PROTOCOLS")}
<div class="content">
  <div style="padding:24px 24px 16px">
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;text-transform:uppercase;letter-spacing:-0.02em;color:#e0e8fa;line-height:1;margin:0 0 6px">Protocol Library</h1>
    <p style="color:#a3abbc;font-size:13px;margin:0">Calibrated to your dive data.</p>
  </div>
  {cards_html}
</div>
{bnav("protocol")}
</div>"""
    st.markdown(html, unsafe_allow_html=True)

    # Handle protocol start via query param
    if sel:
        proto = next((p for p in protos if p['key'] == sel), protos[0])
        st.session_state.update({
            'active_protocol': proto,
            'sess_set': 1, 'sess_phase': 'HOLD',
            'sess_start': time_module.time()
        })
        st.session_state.page = "active"
        st.query_params.clear()
        st.rerun()


def screen_active():
    p       = st.session_state.get('active_protocol', {"name":"CO2 TOLERANCE_01","cycles":8,"hold":"3:15","rest":"1:30","color":"#00F0FF"})
    cur_set = st.session_state.get('sess_set', 1)
    phase   = st.session_state.get('sess_phase', 'HOLD')
    t0      = st.session_state.get('sess_start', time_module.time())
    cycles  = p.get('cycles', 8)

    def pms(s):
        pts = s.split(':'); return int(pts[0])*60+int(pts[1]) if len(pts)==2 else 195

    hold_s  = pms(p.get('hold','3:15')); rest_s = pms(p.get('rest','1:30'))
    phase_s = hold_s if phase=='HOLD' else rest_s
    elapsed  = int(time_module.time() - t0)
    remaining = max(0, phase_s - elapsed)
    pct      = 1 - (remaining / phase_s if phase_s else 1)
    color    = p.get('color','#00F0FF')

    r = 44; circ = 2*math.pi*r
    filled = circ*pct; empty = circ-filled
    total_left = max(0, cycles*(hold_s+rest_s) - ((cur_set-1)*(hold_s+rest_s)+elapsed)) // 60
    timer_str  = f"{remaining//60:02d}:{remaining%60:02d}"

    dots = "".join(
        f'<span style="width:6px;height:6px;border-radius:50%;display:inline-block;background:{color if i<=cur_set-1 else "#404857"}"></span>'
        for i in range(min(cycles,8))
    )

    html = f"""<div class="apnea" style="padding-bottom:120px">
  <header style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 0">
    <div style="display:flex;align-items:center;gap:8px">
      <span class="mi" style="color:{color};font-size:20px">terminal</span>
      <span style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:{color};font-size:12px;text-transform:uppercase;letter-spacing:-0.02em">NAVIGATOR_01</span>
    </div>
  </header>
  <div style="display:flex;justify-content:space-between;padding:20px 24px 0;opacity:0.7;max-width:480px;margin:0 auto">
    <div><div style="font-family:'Space Grotesk',sans-serif;font-size:10px;color:{color};text-transform:uppercase;letter-spacing:0.2em">Protocol</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;color:#e0e8fa">{p['name'][:18]}</div></div>
    <div style="text-align:right"><div style="font-family:'Space Grotesk',sans-serif;font-size:10px;color:{color};text-transform:uppercase;letter-spacing:0.2em">Target</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;color:#e0e8fa">{p.get('hold','—')}</div></div>
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;padding:16px 24px 24px;max-width:480px;margin:0 auto">
    <div style="position:relative;width:280px;height:280px;display:flex;align-items:center;justify-content:center">
      <svg style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="{r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="0.8" transform="rotate(-90 50 50)"/>
        <circle cx="50" cy="50" r="{r}" fill="none" stroke="{color}" stroke-width="2.5"
          stroke-dasharray="{filled:.2f} {empty:.2f}" stroke-linecap="square" transform="rotate(-90 50 50)"
          style="filter:drop-shadow(0 0 15px {color}60)"/>
      </svg>
      <span style="font-family:'Space Grotesk',sans-serif;font-size:64px;font-weight:300;color:#e0e8fa;letter-spacing:-0.04em;line-height:1;position:relative">{timer_str}</span>
    </div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;letter-spacing:0.3em;color:{color};text-transform:uppercase;margin-top:8px">{phase}</div>
    <div style="display:flex;gap:6px;margin-top:10px">{dots}</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-size:10px;color:#6d7685;letter-spacing:0.15em;text-transform:uppercase;margin-top:14px">SET {cur_set} OF {cycles} · {total_left} MIN LEFT</div>
  </div>
</div>"""
    st.markdown(html, unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 2, 1])
    with col1:
        if st.button("⏮", key="ap", use_container_width=True):
            st.session_state.sess_set   = max(1, cur_set-1)
            st.session_state.sess_start = time_module.time(); st.rerun()
    with col2:
        lbl = "⏭ NEXT SET" if cur_set < cycles else "✓ FINISH"
        if st.button(lbl, key="an", use_container_width=True):
            if cur_set < cycles:
                st.session_state.sess_set   = cur_set+1
                st.session_state.sess_phase = 'REST' if phase=='HOLD' else 'HOLD'
                st.session_state.sess_start = time_module.time(); st.rerun()
            else:
                st.session_state.page = "protocol"; st.rerun()
    with col3:
        if st.button("✕", key="ax", use_container_width=True):
            st.session_state.page = "protocol"; st.rerun()

    time_module.sleep(1); st.rerun()


def screen_profile():
    dives_df = load_dives()
    total_dives = 0; pb_depth = 0.0
    if not dives_df.empty:
        for _, row in dives_df.iterrows():
            m = meta(row); total_dives += m.get('diveCount',0)
            d = m.get('maxDepth',0)/100
            if d > pb_depth: pb_depth = d

    html = f"""<div class="apnea">
{topbar_html("PROFILE")}
<div class="content">
  <div style="padding:28px 24px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="width:72px;height:72px;background:#0f1a29;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;border:2px solid rgba(0,240,255,0.2)">
        <span class="mi fill" style="color:#00F0FF;font-size:36px">person</span>
      </div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:#e0e8fa">Mukesh</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:11px;color:#a3abbc;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px">Freediver · Garmin Connected</div>
    </div>
    <div class="sg">
      <div class="sb"><div class="sb-n">{len(dives_df)}</div><span class="sb-l">Sessions</span></div>
      <div class="sb"><div class="sb-n">{total_dives}</div><span class="sb-l">Total Dives</span></div>
      <div class="sb"><div class="sb-n">{pb_depth:.1f}m</div><span class="sb-l">PB Depth</span></div>
    </div>
    <div style="background:rgba(0,240,255,0.04);border:1px solid rgba(0,240,255,0.15);border-radius:2px;padding:16px 20px;display:flex;align-items:center;gap:16px">
      <span class="mi" style="color:#00F0FF;font-size:28px">watch</span>
      <div><div style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:700;color:#e0e8fa">Garmin Connected</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:11px;color:#a3abbc;margin-top:2px">Syncing automatically</div></div>
      <span class="mi fill" style="color:#00F0FF;margin-left:auto">check_circle</span>
    </div>
  </div>
</div>
{bnav("profile")}
</div>"""
    st.markdown(html, unsafe_allow_html=True)

    col = st.columns([1,2,1])[1]
    with col:
        if st.button("🔄  SYNC GARMIN DATA", use_container_width=True):
            with st.spinner("Syncing..."):
                venv_py = str(Path(__file__).parent.parent / 'venv' / 'bin' / 'python')
                script  = str(Path(__file__).parent.parent / 'src' / 'sync' / 'garmin_sync.py')
                try:
                    res = subprocess.run([venv_py, script, '--today'], capture_output=True, text=True, timeout=30)
                    if res.returncode == 0:
                        load_health.clear(); load_dives.clear(); st.success("Synced!"); st.rerun()
                    else: st.error(f"Sync failed: {res.stderr[:200]}")
                except Exception as e: st.error(str(e))


# ── Screenshot helper (debug) ─────────────────────────────────────────────────

def take_screenshot(url="http://localhost:8503", path="/home/clawd/apnea_debug.png", width=480, height=900, wait=5):
    """Take a screenshot using selenium + snap chromium."""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.chrome.options import Options
        opts = Options()
        for arg in ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',f'--window-size={width},{height}']:
            opts.add_argument(arg)
        svc    = Service('/snap/bin/chromium.chromedriver')
        driver = webdriver.Chrome(service=svc, options=opts)
        driver.get(url); time_module.sleep(wait)
        driver.save_screenshot(path)
        driver.quit()
        return path
    except Exception as e:
        return str(e)


# ── Sync action ───────────────────────────────────────────────────────────────

if st.query_params.get("action") == "sync":
    st.query_params.clear()
    with st.spinner("Syncing Garmin data..."):
        venv_py = str(Path(__file__).parent.parent / 'venv' / 'bin' / 'python')
        script  = str(Path(__file__).parent.parent / 'src' / 'sync' / 'garmin_sync.py')
        try:
            res = subprocess.run([venv_py, script, '--today'], capture_output=True, text=True, timeout=60)
            load_health.clear(); load_dives.clear()
            if res.returncode == 0:
                st.toast("Garmin sync complete!", icon="✅")
            else:
                st.toast(f"Sync failed: {res.stderr[:120]}", icon="⚠️")
        except Exception as e:
            st.toast(str(e), icon="⚠️")
    st.rerun()

# ── Router ────────────────────────────────────────────────────────────────────

page = get_page()
if   page == "dashboard": screen_dashboard()
elif page == "log":        screen_log()
elif page == "protocol":   screen_protocol()
elif page == "active":     screen_active()
elif page == "profile":    screen_profile()
else:                      screen_dashboard()
