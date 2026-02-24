#!/usr/bin/env python3
"""
Garmin Freediving Coach - Dashboard (Mobile-Optimized)
"""

import streamlit as st
import sqlite3
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from datetime import date, timedelta, datetime
from pathlib import Path
import json
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Mobile-friendly page config
st.set_page_config(
    page_title="🤿 Freediving Coach",
    page_icon="🤿",
    layout="wide",
    initial_sidebar_state="auto",
    menu_items={
        'About': "AI-powered freediving training optimization"
    }
)

# Custom CSS for mobile responsiveness
st.markdown("""
<style>
    /* Mobile optimizations */
    @media (max-width: 768px) {
        .block-container {
            padding: 1rem !important;
        }
        h1 {
            font-size: 1.5rem !important;
        }
        h2 {
            font-size: 1.3rem !important;
        }
        h3 {
            font-size: 1.1rem !important;
        }
        .stMetric {
            background: rgba(28, 131, 225, 0.1);
            padding: 0.5rem;
            border-radius: 0.5rem;
        }
    }
    
    /* Dive card styling */
    .dive-card {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 1rem;
        border-radius: 1rem;
        color: white;
        margin: 1rem 0;
    }
    
    .analysis-card {
        background: rgba(255, 255, 255, 0.05);
        border-left: 4px solid #00D9FF;
        padding: 1rem;
        border-radius: 0.5rem;
        margin: 0.5rem 0;
    }
    
    /* Compact metrics for mobile */
    .metric-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.5rem 0;
    }
</style>
""", unsafe_allow_html=True)

# Database connection
DB_PATH = Path(__file__).parent.parent / 'data' / 'freediving.db'

def get_db_connection():
    """Get SQLite database connection"""
    return sqlite3.connect(str(DB_PATH))

def load_health_metrics():
    """Load all health metrics"""
    conn = get_db_connection()
    df = pd.read_sql_query("""
        SELECT * FROM health_metrics 
        ORDER BY date DESC
    """, conn)
    conn.close()
    return df

def load_activities():
    """Load all activities"""
    conn = get_db_connection()
    df = pd.read_sql_query("""
        SELECT * FROM activities 
        ORDER BY start_time DESC
    """, conn)
    conn.close()
    return df

def analyze_dive(dive_data):
    """
    Comprehensive dive analysis with AI insights
    
    Args:
        dive_data: Row from activities DataFrame
        
    Returns:
        dict: Analysis results with insights and recommendations
    """
    analysis = {
        'timestamp': dive_data['start_time'],
        'overall_grade': '',
        'insights': [],
        'recommendations': [],
        'stats': {},
        'safety_notes': []
    }
    
    try:
        metadata = json.loads(dive_data['metadata']) if pd.notna(dive_data['metadata']) else {}
        
        # Extract key metrics (Garmin returns depth in centimeters)
        max_depth = metadata.get('maxDepth', 0) / 100  # Convert cm to meters
        avg_depth = metadata.get('avgDepth', 0) / 100  # Convert cm to meters
        dive_count = metadata.get('diveCount', 0)
        bottom_time = metadata.get('bottomTime', 0)
        duration = dive_data['duration'] / 60 if pd.notna(dive_data['duration']) else 0
        avg_hr = dive_data['avg_hr']
        max_hr = dive_data['max_hr']
        water_temp = metadata.get('minTemperature', 0)
        surface_interval = metadata.get('surfaceInterval', 0) / 1000  # Convert to seconds
        
        analysis['stats'] = {
            'max_depth': max_depth,
            'avg_depth': avg_depth,
            'dive_count': dive_count,
            'bottom_time': bottom_time,
            'duration_min': duration,
            'avg_hr': avg_hr,
            'max_hr': max_hr,
            'water_temp': water_temp,
            'surface_interval': surface_interval
        }
        
        # Performance grading
        points = 0
        
        # 1. Depth Analysis (pool diving: max 5m)
        if max_depth > 0:
            if max_depth >= 4.5:
                analysis['insights'].append(("🏆", f"Maximum depth reached: {max_depth:.1f}m! Using full pool depth."))
                points += 30
            elif max_depth >= 3.5:
                analysis['insights'].append(("🎯", f"Strong depth: {max_depth:.1f}m. Good depth utilization."))
                points += 25
            elif max_depth >= 2.5:
                analysis['insights'].append(("✅", f"Moderate depth: {max_depth:.1f}m. Building comfort."))
                points += 20
            else:
                analysis['insights'].append(("🟡", f"Depth: {max_depth:.1f}m. Shallow training - focus on equalization."))
                points += 10
        
        # 2. Volume Analysis (dive count)
        if dive_count > 0:
            if dive_count >= 8:
                analysis['insights'].append(("💪", f"High volume: {dive_count} dives! Great training stimulus."))
                points += 25
            elif dive_count >= 5:
                analysis['insights'].append(("👍", f"Good volume: {dive_count} dives. Balanced session."))
                points += 20
            elif dive_count >= 3:
                analysis['insights'].append(("✓", f"{dive_count} dives - adequate for skill maintenance."))
                points += 15
            else:
                analysis['insights'].append(("⚠️", f"Low volume: {dive_count} dives. Consider more repetitions."))
                points += 5
        
        # 3. Heart Rate Efficiency
        if avg_hr and max_hr:
            hr_range = max_hr - avg_hr
            if avg_hr < 70:
                analysis['insights'].append(("❤️", f"Excellent HR control: {avg_hr} bpm average. Very relaxed!"))
                points += 25
            elif avg_hr < 85:
                analysis['insights'].append(("✅", f"Good HR: {avg_hr} bpm. Decent relaxation level."))
                points += 20
            else:
                analysis['insights'].append(("🟡", f"Elevated HR: {avg_hr} bpm. Work on relaxation techniques."))
                points += 10
                analysis['recommendations'].append("Practice box breathing (4-4-4-4) to lower resting HR during dives")
        
        # 4. Bottom Time
        if bottom_time > 0:
            avg_bottom_per_dive = bottom_time / dive_count if dive_count > 0 else 0
            if avg_bottom_per_dive >= 15:
                analysis['insights'].append(("⏱️", f"Strong bottom time: {avg_bottom_per_dive:.1f}s average per dive"))
                points += 20
            elif avg_bottom_per_dive >= 10:
                analysis['insights'].append(("✓", f"Decent bottom time: {avg_bottom_per_dive:.1f}s average"))
                points += 15
        
        # 5. Safety Check - Surface Intervals
        if surface_interval > 0:
            avg_surface = surface_interval / dive_count if dive_count > 0 else 0
            if avg_surface < 60:  # Less than 1 minute
                analysis['safety_notes'].append("⚠️ SHORT SURFACE INTERVALS: Average " + 
                    f"{avg_surface:.0f}s. Minimum 1-2 min recommended for pool training")
            elif avg_surface >= 120:  # 2+ minutes
                analysis['insights'].append(("🛡️", f"Excellent recovery: {avg_surface:.0f}s surface intervals"))
            else:
                analysis['insights'].append(("✓", f"Adequate surface intervals: {avg_surface:.0f}s average"))
        
        # 6. Water Temperature
        if water_temp > 0:
            if water_temp < 20:
                analysis['safety_notes'].append(f"🥶 Cold water ({water_temp}°C) - Watch for hypothermia symptoms")
            elif water_temp < 24:
                analysis['insights'].append(("🌊", f"Cool water: {water_temp}°C. Good for CO2 tolerance."))
            else:
                analysis['insights'].append(("☀️", f"Warm water: {water_temp}°C. Comfortable conditions."))
        
        # Overall Grade
        if points >= 90:
            analysis['overall_grade'] = "A+ 🏆"
            analysis['recommendations'].append("Outstanding session! Consider progressive depth increases (+2-3m)")
        elif points >= 80:
            analysis['overall_grade'] = "A 🎯"
            analysis['recommendations'].append("Excellent work! Maintain this consistency for steady progress")
        elif points >= 70:
            analysis['overall_grade'] = "B+ ✅"
            analysis['recommendations'].append("Solid session. Focus on heart rate control for next level")
        elif points >= 60:
            analysis['overall_grade'] = "B 👍"
            analysis['recommendations'].append("Good foundation. Increase dive count for better conditioning")
        else:
            analysis['overall_grade'] = "C 🟡"
            analysis['recommendations'].append("Build volume gradually. Quality over depth at this stage")
        
        # Training Recommendations
        if dive_count < 5:
            analysis['recommendations'].append("Aim for 6-8 dives per session for optimal training adaptation")
        
        if dive_count >= 5 and avg_surface < 90:
            analysis['recommendations'].append("For high-volume sessions, take 1.5-2 min surface intervals")
        
        # Recovery Recommendations
        analysis['recommendations'].append("Post-dive: Eat within 30min (protein + carbs) for optimal recovery")
        analysis['recommendations'].append("Monitor HRV tomorrow - expect 5-10% drop after intense session")
        
    except Exception as e:
        analysis['insights'].append(("⚠️", f"Analysis error: {str(e)}"))
        analysis['overall_grade'] = "N/A"
    
    return analysis

def store_dive_analysis(dive_id, analysis):
    """Store dive analysis in database"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if dive_analysis table exists, create if not
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dive_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            activity_id INTEGER REFERENCES activities(id),
            analysis_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            overall_grade TEXT,
            insights JSON,
            recommendations JSON,
            stats JSON,
            safety_notes JSON
        )
    """)
    
    # Insert analysis
    cursor.execute("""
        INSERT INTO dive_analysis 
        (activity_id, overall_grade, insights, recommendations, stats, safety_notes)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        dive_id,
        analysis['overall_grade'],
        json.dumps(analysis['insights']),
        json.dumps(analysis['recommendations']),
        json.dumps(analysis['stats']),
        json.dumps(analysis['safety_notes'])
    ))
    
    conn.commit()
    conn.close()

def get_last_analyzed_dive():
    """Get ID of last analyzed dive"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if table exists
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='dive_analysis'
    """)
    
    if not cursor.fetchone():
        conn.close()
        return None
    
    cursor.execute("""
        SELECT MAX(activity_id) FROM dive_analysis
    """)
    result = cursor.fetchone()
    conn.close()
    
    return result[0] if result else None

def calculate_readiness(row):
    """Calculate readiness score from health metrics"""
    score = 0
    factors = {}
    
    # HRV component (40% weight) - higher is better
    if pd.notna(row['hrv_avg']):
        hrv_score = min(100, (row['hrv_avg'] / 80) * 100)  # Normalize to 80ms
        score += hrv_score * 0.4
        factors['HRV'] = hrv_score
    
    # Sleep component (30% weight)
    if pd.notna(row['sleep_score']):
        sleep_score = row['sleep_score']
        score += sleep_score * 0.3
        factors['Sleep'] = sleep_score
    
    # Body Battery component (20% weight)
    if pd.notna(row['body_battery_charged']):
        bb_score = row['body_battery_charged']
        score += bb_score * 0.2
        factors['Recovery'] = bb_score
    
    # Stress component (10% weight) - lower is better
    if pd.notna(row['stress_avg']):
        stress_score = max(0, 100 - row['stress_avg'])
        score += stress_score * 0.1
        factors['Stress'] = stress_score
    
    return score, factors

# Sidebar - Compact for mobile
with st.sidebar:
    st.title("🤿 Coach")
    
    # Sync button
    if st.button("🔄 Sync", use_container_width=True):
        with st.spinner("Syncing..."):
            import subprocess
            
            venv_python = str(Path(__file__).parent.parent / 'venv' / 'bin' / 'python')
            sync_script = str(Path(__file__).parent.parent / 'src' / 'sync' / 'garmin_sync.py')
            
            try:
                result = subprocess.run(
                    [venv_python, sync_script, '--today'],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                if result.returncode == 0:
                    st.success("✅ Synced!")
                    st.rerun()
                else:
                    st.error(f"❌ Failed")
            except:
                st.error("⏱️ Timeout")
    
    # Last sync time
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(synced_at) FROM health_metrics")
        last_sync = cursor.fetchone()[0]
        conn.close()
        
        if last_sync:
            sync_time = datetime.fromisoformat(last_sync)
            st.caption(f"🕐 {sync_time.strftime('%b %d, %I:%M %p')}")
    except:
        pass
    
    st.divider()
    
    # Navigation
    page = st.radio("", [
        "📊 Overview",
        "🤿 Dive Log",
        "💓 Health",
        "📈 Training"
    ], label_visibility="collapsed")

# Load data
health_df = load_health_metrics()
activities_df = load_activities()

# Main content
if page == "📊 Overview":
    st.title("📊 Dashboard")
    
    # Today's readiness - Mobile optimized
    if len(health_df) > 0:
        latest = health_df.iloc[0]
        readiness_score, factors = calculate_readiness(latest)
        
        # Compact metrics for mobile
        cols = st.columns(2)
        
        with cols[0]:
            st.metric("Readiness", f"{readiness_score:.0f}%")
            
            if readiness_score >= 80:
                st.success("✅ Peak condition!")
            elif readiness_score >= 60:
                st.info("🟡 Moderate")
            else:
                st.warning("⚠️ Rest day")
        
        with cols[1]:
            hrv_val = latest['hrv_avg'] if pd.notna(latest['hrv_avg']) else 0
            st.metric("HRV", f"{hrv_val:.0f}ms" if hrv_val > 0 else "—")
            
            sleep_hrs = latest['sleep_duration'] / 60 if pd.notna(latest['sleep_duration']) else 0
            st.metric("Sleep", f"{sleep_hrs:.1f}h")
        
        st.divider()
        
        # AI Insights - Compact
        st.subheader("💡 Today's Insights")
        
        insights = []
        
        # HRV insight
        if hrv_val > 0:
            recent_hrv = health_df.head(7)['hrv_avg'].dropna()
            if len(recent_hrv) >= 3:
                avg_hrv = recent_hrv.mean()
                if hrv_val > avg_hrv * 1.1:
                    insights.append(f"🟢 HRV +{((hrv_val/avg_hrv - 1) * 100):.0f}% above avg - excellent!")
                elif hrv_val < avg_hrv * 0.9:
                    insights.append(f"🟡 HRV -{((1 - hrv_val/avg_hrv) * 100):.0f}% below avg - consider rest")
        
        # Sleep insight
        if sleep_hrs > 0:
            if sleep_hrs >= 8:
                insights.append(f"🟢 {sleep_hrs:.1f}h sleep - optimal!")
            elif sleep_hrs < 7:
                insights.append(f"🔴 {sleep_hrs:.1f}h sleep - affects breath-hold by ~20%")
        
        # Display insights
        for insight in insights:
            st.markdown(f"**{insight}**")
        
        st.divider()
        
        # Recent dives
        st.subheader("Recent Dives")
        
        apnea_activities = activities_df[activities_df['activity_type'] == 'apnea_diving'].head(3)
        
        if len(apnea_activities) > 0:
            for _, dive in apnea_activities.iterrows():
                try:
                    metadata = json.loads(dive['metadata']) if pd.notna(dive['metadata']) else {}
                    max_depth = metadata.get('maxDepth', 0)
                    dive_count = metadata.get('diveCount', 0)
                    
                    dive_date = pd.to_datetime(dive['start_time']).strftime('%b %d')
                    
                    with st.expander(f"🤿 {dive_date} - {max_depth:.0f}m × {dive_count}", expanded=False):
                        analysis = analyze_dive(dive)
                        
                        st.markdown(f"### Grade: {analysis['overall_grade']}")
                        
                        for icon, insight in analysis['insights'][:3]:  # Top 3 insights
                            st.markdown(f"{icon} {insight}")
                except:
                    pass
        else:
            st.info("No dive data yet. Sync your watch!")

elif page == "🤿 Dive Log":
    st.title("🤿 Dive Log")
    
    apnea_activities = activities_df[activities_df['activity_type'] == 'apnea_diving']
    
    if len(apnea_activities) > 0:
        st.caption(f"📊 Total sessions: {len(apnea_activities)}")
        
        # Check for new dives and analyze
        last_analyzed = get_last_analyzed_dive()
        
        for idx, dive in apnea_activities.iterrows():
            dive_id = dive['id']
            
            # Auto-analyze new dives
            if last_analyzed is None or dive_id > last_analyzed:
                st.info("🔍 Analyzing new dive...")
                analysis = analyze_dive(dive)
                store_dive_analysis(dive_id, analysis)
                
                # Notify user
                st.balloons()
                st.success(f"✅ New dive analyzed! Grade: {analysis['overall_grade']}")
            
            try:
                metadata = json.loads(dive['metadata']) if pd.notna(dive['metadata']) else {}
                max_depth = metadata.get('maxDepth', 0)
                dive_count = metadata.get('diveCount', 0)
                location = metadata.get('locationName', 'Unknown')
                
                dive_date = pd.to_datetime(dive['start_time']).strftime('%b %d, %Y %I:%M %p')
                
                with st.expander(f"📅 {dive_date} - {location}", expanded=False):
                    # Generate analysis
                    analysis = analyze_dive(dive)
                    
                    # Grade banner
                    st.markdown(f"<div class='dive-card'><h2>Grade: {analysis['overall_grade']}</h2></div>", 
                               unsafe_allow_html=True)
                    
                    # Stats grid - mobile friendly
                    cols = st.columns(2)
                    stats = analysis['stats']
                    
                    with cols[0]:
                        st.metric("Max Depth", f"{stats['max_depth']:.1f}m")
                        st.metric("Dives", f"{stats['dive_count']}")
                        st.metric("Avg HR", f"{stats['avg_hr']} bpm")
                    
                    with cols[1]:
                        st.metric("Duration", f"{stats['duration_min']:.0f} min")
                        st.metric("Water Temp", f"{stats['water_temp']:.0f}°C")
                        st.metric("Bottom Time", f"{stats['bottom_time']:.0f}s")
                    
                    # Safety Notes
                    if analysis['safety_notes']:
                        st.warning("### ⚠️ Safety Notes")
                        for note in analysis['safety_notes']:
                            st.markdown(note)
                    
                    # Insights
                    st.markdown("### 📊 Performance Insights")
                    for icon, insight in analysis['insights']:
                        st.markdown(f"<div class='analysis-card'>{icon} {insight}</div>", 
                                   unsafe_allow_html=True)
                    
                    # Recommendations
                    if analysis['recommendations']:
                        st.markdown("### 💡 Recommendations")
                        for rec in analysis['recommendations']:
                            st.markdown(f"- {rec}")
                    
            except Exception as e:
                st.error(f"Error loading dive: {str(e)}")
    else:
        st.info("No dive sessions found. Sync your watch!")

elif page == "💓 Health":
    st.title("💓 Health Metrics")
    
    if len(health_df) > 0:
        # Compact date selector
        days_back = st.selectbox("Period", [7, 14, 30], index=0)
        
        recent_health = health_df.head(days_back).sort_values('date')
        
        # HRV Trend - Mobile optimized
        st.subheader("HRV Trend")
        
        fig_hrv = go.Figure()
        fig_hrv.add_trace(go.Scatter(
            x=recent_health['date'],
            y=recent_health['hrv_avg'],
            mode='lines+markers',
            name='HRV',
            line=dict(color='#FF6B6B', width=2),
            marker=dict(size=4)
        ))
        
        fig_hrv.update_layout(
            xaxis_title="",
            yaxis_title="HRV (ms)",
            height=250,
            margin=dict(l=20, r=20, t=20, b=20),
            hovermode='x unified'
        )
        
        st.plotly_chart(fig_hrv, use_container_width=True)
        st.caption("💡 Higher = better recovery")
        
        # Sleep Quality
        st.subheader("Sleep Quality")
        
        fig_sleep = go.Figure()
        fig_sleep.add_trace(go.Bar(
            x=recent_health['date'],
            y=recent_health['sleep_score'],
            name='Score',
            marker_color='#4ECDC4'
        ))
        
        fig_sleep.update_layout(
            xaxis_title="",
            yaxis_title="Score",
            yaxis_range=[0, 100],
            height=250,
            margin=dict(l=20, r=20, t=20, b=20),
            hovermode='x unified'
        )
        
        st.plotly_chart(fig_sleep, use_container_width=True)

elif page == "📈 Training":
    st.title("📈 Training Plan")
    
    if len(health_df) > 0:
        latest = health_df.iloc[0]
        readiness_score, _ = calculate_readiness(latest)
        
        # Training recommendation based on readiness
        if readiness_score >= 80:
            st.success("### 🎯 High Readiness")
            st.markdown("""
**Today's Workout:**
- Depth training: 3-4 sets
- Target: 85-90% max depth
- Surface: 3 min rest
- Focus: Relaxation at depth

**Warm-up:**
- CO2 table (4 rounds)
- 2:00 hold / 1:30 rest
            """)
        elif readiness_score >= 60:
            st.info("### 🟡 Moderate Readiness")
            st.markdown("""
**Today's Workout:**
- Dynamic or pool work
- 5-6 moderate dives
- Target: 70-80% intensity
- Focus: Technique

**Alternative:**
- CO2 tables
- Light static apnea
            """)
        else:
            st.warning("### ⚠️ Low Readiness")
            st.markdown("""
**Today:**
- **Rest day** recommended
- Yoga / stretching
- Breathing exercises only
- Focus on recovery

**Why rest:**
Low HRV = incomplete recovery. 
Pushing through increases injury risk.
            """)

# Footer
st.divider()
st.caption("🤿 Freediving Coach | Auto-analyzing your dives | HRV-powered readiness")
