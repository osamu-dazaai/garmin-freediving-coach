#!/usr/bin/env python3
"""
Dive Labeling Interface - Build Personal Baselines

This page allows users to manually label dives (discipline + lung volume)
to train the AI classification system.
"""

import streamlit as st
import sqlite3
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime, date
from pathlib import Path
import sys
import json

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.core.baseline_manager import BaselineManager

# Page config
st.set_page_config(
    page_title="🏷️ Label Dives",
    page_icon="🏷️",
    layout="wide"
)

# Mobile CSS
st.markdown("""
<style>
    @media (max-width: 768px) {
        .block-container {
            padding: 1rem !important;
        }
        .stButton button {
            width: 100% !important;
            margin: 0.25rem 0 !important;
        }
    }
    .dive-card {
        background: #f0f2f6;
        border-radius: 8px;
        padding: 1rem;
        margin: 0.5rem 0;
    }
    .labeled {
        background: #d4edda !important;
        border-left: 4px solid #28a745;
    }
    .unlabeled {
        background: #fff3cd !important;
        border-left: 4px solid #ffc107;
    }
</style>
""", unsafe_allow_html=True)

# Database path
DB_PATH = Path(__file__).parent.parent.parent / "garmin_coach.db"

def get_unlabeled_dives(limit=20):
    """Get dives that need labeling"""
    conn = sqlite3.connect(DB_PATH)
    query = """
        SELECT 
            id, activity_id, dive_number, start_time,
            max_depth, total_duration, bottom_duration,
            avg_descent_rate, avg_ascent_rate,
            avg_hr, min_hr, max_hr,
            ai_discipline, ai_discipline_confidence,
            ai_lung_volume, ai_lung_confidence,
            manual_discipline, manual_lung_volume, manual_notes
        FROM dive_sessions_enhanced
        ORDER BY 
            CASE WHEN manual_discipline IS NULL AND manual_lung_volume IS NULL THEN 0 ELSE 1 END,
            start_time DESC
        LIMIT ?
    """
    df = pd.read_sql_query(query, conn, params=(limit,))
    conn.close()
    return df

def label_dive(dive_id, discipline=None, lung_volume=None, notes=""):
    """Save manual labels for a dive"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        UPDATE dive_sessions_enhanced
        SET manual_discipline = ?,
            manual_lung_volume = ?,
            manual_notes = ?,
            labeled_at = ?
        WHERE id = ?
    """, (discipline, lung_volume, notes, datetime.now().isoformat(), dive_id))
    conn.commit()
    conn.close()

def get_dive_profile_data(dive_id):
    """Get time-series data for visualization"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute("""
        SELECT depth_profile, velocity_profile, hr_profile
        FROM dive_sessions_enhanced
        WHERE id = ?
    """, (dive_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            'depth': json.loads(row[0]) if row[0] else None,
            'velocity': json.loads(row[1]) if row[1] else None,
            'hr': json.loads(row[2]) if row[2] else None
        }
    return None

def plot_dive_profile(dive_id):
    """Plot dive depth, velocity, and HR"""
    data = get_dive_profile_data(dive_id)
    
    if not data or not data['depth']:
        st.info("No profile data available for this dive")
        return
    
    depth = data['depth']
    time_axis = list(range(len(depth)))
    
    fig = go.Figure()
    
    # Depth (inverted Y-axis)
    fig.add_trace(go.Scatter(
        x=time_axis,
        y=[-d for d in depth],
        name="Depth (m)",
        line=dict(color='#1f77b4', width=3),
        fill='tonexty',
        fillcolor='rgba(31, 119, 180, 0.3)'
    ))
    
    fig.update_layout(
        title="Dive Profile",
        xaxis_title="Time (seconds)",
        yaxis_title="Depth (m)",
        height=300,
        margin=dict(l=20, r=20, t=40, b=20),
        hovermode='x unified'
    )
    
    st.plotly_chart(fig, use_container_width=True)
    
    # Velocity & HR (if available)
    if data['velocity'] or data['hr']:
        fig2 = go.Figure()
        
        if data['velocity']:
            fig2.add_trace(go.Scatter(
                x=time_axis[:len(data['velocity'])],
                y=data['velocity'],
                name="Velocity (m/s)",
                line=dict(color='#ff7f0e')
            ))
        
        if data['hr']:
            fig2.add_trace(go.Scatter(
                x=time_axis[:len(data['hr'])],
                y=data['hr'],
                name="HR (bpm)",
                line=dict(color='#d62728'),
                yaxis='y2'
            ))
        
        fig2.update_layout(
            title="Velocity & Heart Rate",
            xaxis_title="Time (seconds)",
            yaxis_title="Velocity (m/s)",
            yaxis2=dict(
                title="HR (bpm)",
                overlaying='y',
                side='right'
            ),
            height=250,
            margin=dict(l=20, r=20, t=40, b=20),
            hovermode='x unified'
        )
        
        st.plotly_chart(fig2, use_container_width=True)

# Header
st.title("🏷️ Label Dives")
st.markdown("Build your personal baseline by labeling dives")

# Get baseline manager
manager = BaselineManager(str(DB_PATH))
progress = manager.get_calibration_progress()

# Calibration progress
st.markdown("### 📊 Calibration Progress")

col1, col2, col3 = st.columns(3)
with col1:
    st.metric("Labeled Dives", f"{progress['total_labeled']}/20")
with col2:
    st.metric("Progress", f"{progress['progress_percent']:.0f}%")
with col3:
    status_emoji = "✅" if progress['complete'] else "🔄"
    status_text = "Complete" if progress['complete'] else "In Progress"
    st.metric("Status", f"{status_emoji} {status_text}")

st.progress(progress['progress_percent'] / 100)
st.info(progress['message'])

# Dive breakdown
if progress['breakdown']:
    st.markdown("#### Dive Distribution")
    breakdown_data = []
    for combo, count in progress['breakdown'].items():
        parts = combo.split('_')
        discipline = parts[0] if len(parts) > 0 else 'unknown'
        lung = parts[1] if len(parts) > 1 else 'unknown'
        breakdown_data.append({
            'Discipline': discipline.upper(),
            'Lung Volume': lung.title(),
            'Count': count
        })
    
    if breakdown_data:
        df_breakdown = pd.DataFrame(breakdown_data)
        st.dataframe(df_breakdown, use_container_width=True, hide_index=True)

st.markdown("---")

# Dive labeling interface
st.markdown("### 🏊 Label Dives")

# Filter options
col1, col2 = st.columns(2)
with col1:
    show_labeled = st.checkbox("Show already labeled", value=False)
with col2:
    dives_to_show = st.slider("Dives to show", 5, 50, 20)

# Get dives
dives = get_unlabeled_dives(limit=dives_to_show)

if dives.empty:
    st.warning("No dives found. Sync from Garmin first!")
else:
    st.markdown(f"**{len(dives)} dives** (newest first)")
    
    # Process each dive
    for idx, dive in dives.iterrows():
        is_labeled = pd.notna(dive['manual_discipline']) or pd.notna(dive['manual_lung_volume'])
        
        # Skip labeled dives if filter is off
        if is_labeled and not show_labeled:
            continue
        
        # Dive card
        card_class = "labeled" if is_labeled else "unlabeled"
        
        with st.container():
            st.markdown(f'<div class="dive-card {card_class}">', unsafe_allow_html=True)
            
            # Header
            col1, col2, col3 = st.columns([3, 1, 1])
            with col1:
                dive_time = datetime.fromisoformat(dive['start_time']).strftime("%b %d, %Y %H:%M")
                st.markdown(f"**Dive #{dive['dive_number']}** · {dive_time}")
            with col2:
                if is_labeled:
                    st.markdown("✅ **Labeled**")
                else:
                    st.markdown("⏳ **Unlabeled**")
            
            # Metrics
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.metric("Max Depth", f"{dive['max_depth']:.1f}m")
            with col2:
                st.metric("Time", f"{dive['total_duration']:.0f}s")
            with col3:
                st.metric("Avg HR", f"{dive['avg_hr']:.0f}" if pd.notna(dive['avg_hr']) else "N/A")
            with col4:
                st.metric("Descent", f"{dive['avg_descent_rate']:.2f}m/s" if pd.notna(dive['avg_descent_rate']) else "N/A")
            
            # AI suggestion
            if pd.notna(dive['ai_discipline']) or pd.notna(dive['ai_lung_volume']):
                ai_disc = dive['ai_discipline'] or '?'
                ai_disc_conf = dive['ai_discipline_confidence'] or 0
                ai_lung = dive['ai_lung_volume'] or '?'
                ai_lung_conf = dive['ai_lung_confidence'] or 0
                
                st.markdown(f"""
                **🤖 AI Suggestion:**  
                Discipline: {ai_disc.upper()} ({ai_disc_conf:.0f}% confidence) · 
                Lung: {ai_lung.title()} ({ai_lung_conf:.0f}% confidence)
                """)
            
            # Show current labels
            if is_labeled:
                current_disc = dive['manual_discipline'] or dive['ai_discipline'] or 'Not set'
                current_lung = dive['manual_lung_volume'] or dive['ai_lung_volume'] or 'Not set'
                st.markdown(f"**Current:** {current_disc.upper()} · {current_lung.title()}")
                
                if dive['manual_notes']:
                    st.markdown(f"*Notes: {dive['manual_notes']}*")
            
            # Labeling form
            with st.expander("🏷️ Label this dive" if not is_labeled else "✏️ Edit labels"):
                # Show dive profile
                if st.button(f"📊 Show Profile", key=f"profile_{dive['id']}"):
                    plot_dive_profile(dive['id'])
                
                col1, col2 = st.columns(2)
                
                with col1:
                    discipline = st.selectbox(
                        "Discipline",
                        options=['', 'FIM', 'CWT', 'CNF', 'STATIC'],
                        index=0,
                        key=f"disc_{dive['id']}"
                    )
                
                with col2:
                    lung_volume = st.selectbox(
                        "Lung Volume",
                        options=['', 'full', 'frc', 'exhale'],
                        index=0,
                        key=f"lung_{dive['id']}"
                    )
                
                notes = st.text_input(
                    "Notes (optional)",
                    value=dive['manual_notes'] if pd.notna(dive['manual_notes']) else "",
                    key=f"notes_{dive['id']}"
                )
                
                if st.button(f"💾 Save Labels", key=f"save_{dive['id']}", type="primary"):
                    if discipline or lung_volume:
                        label_dive(
                            dive['id'],
                            discipline=discipline if discipline else None,
                            lung_volume=lung_volume if lung_volume else None,
                            notes=notes
                        )
                        st.success("✅ Labels saved!")
                        
                        # Recalculate baselines
                        success, message = manager.update_user_baselines()
                        if success:
                            st.info(f"🧠 {message}")
                        
                        st.rerun()
                    else:
                        st.warning("Select at least discipline or lung volume")
            
            st.markdown('</div>', unsafe_allow_html=True)
            st.markdown("")  # Spacing

# Update baselines button
st.markdown("---")
if st.button("🔄 Recalculate Baselines", type="secondary"):
    with st.spinner("Calculating baselines..."):
        success, message = manager.update_user_baselines()
        if success:
            st.success(message)
            st.rerun()
        else:
            st.error(message)

manager.close()
