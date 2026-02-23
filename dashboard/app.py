#!/usr/bin/env python3
"""
Garmin Freediving Coach - Dashboard
"""

import streamlit as st
import sqlite3
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from datetime import date, timedelta
from pathlib import Path
import json
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Page config
st.set_page_config(
    page_title="Freediving Coach",
    page_icon="🤿",
    layout="wide",
    initial_sidebar_state="expanded"
)

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

# Sidebar
st.sidebar.title("🤿 Freediving Coach")
st.sidebar.markdown("AI-powered training optimization")

# Sync button
st.sidebar.divider()
if st.sidebar.button("🔄 Sync Watch Data", use_container_width=True):
    with st.spinner("Syncing data from Garmin Connect..."):
        import subprocess
        import os
        
        # Run sync script
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
                st.sidebar.success("✅ Sync complete!")
                st.rerun()
            else:
                st.sidebar.error(f"❌ Sync failed: {result.stderr}")
        except subprocess.TimeoutExpired:
            st.sidebar.error("⏱️ Sync timed out. Try again.")
        except Exception as e:
            st.sidebar.error(f"❌ Error: {str(e)}")

# Show last sync time
try:
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(synced_at) FROM health_metrics")
    last_sync = cursor.fetchone()[0]
    conn.close()
    
    if last_sync:
        from datetime import datetime
        sync_time = datetime.fromisoformat(last_sync)
        st.sidebar.caption(f"Last sync: {sync_time.strftime('%b %d, %I:%M %p')}")
except:
    pass

st.sidebar.divider()

page = st.sidebar.radio("Navigation", [
    "📊 Overview",
    "🤿 Dive Log",
    "💓 Health Trends",
    "📈 Training"
])

# Load data
health_df = load_health_metrics()
activities_df = load_activities()

# Main content
if page == "📊 Overview":
    st.title("📊 Training Overview")
    
    # Today's readiness
    if len(health_df) > 0:
        latest = health_df.iloc[0]
        readiness_score, factors = calculate_readiness(latest)
        
        # Readiness card
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            st.metric("Readiness Score", f"{readiness_score:.0f}%", 
                     help="Overall training readiness based on HRV, sleep, recovery, and stress")
            
            # Color-coded recommendation
            if readiness_score >= 80:
                st.success("✅ Great day for depth training!")
            elif readiness_score >= 60:
                st.info("🟡 Moderate training recommended")
            else:
                st.warning("⚠️ Light training or rest day")
        
        with col2:
            hrv_val = latest['hrv_avg'] if pd.notna(latest['hrv_avg']) else 0
            st.metric("HRV", f"{hrv_val:.1f}ms" if hrv_val > 0 else "N/A")
        
        with col3:
            sleep_val = latest['sleep_score'] if pd.notna(latest['sleep_score']) else 0
            sleep_hrs = latest['sleep_duration'] / 60 if pd.notna(latest['sleep_duration']) else 0
            st.metric("Sleep", f"{sleep_hrs:.1f}hrs", 
                     delta=f"{sleep_val:.0f}% quality" if sleep_val > 0 else None)
        
        with col4:
            bb_val = latest['body_battery_charged'] if pd.notna(latest['body_battery_charged']) else 0
            st.metric("Body Battery", f"{bb_val:.0f}%" if bb_val > 0 else "N/A")
        
        # AI Insights
        st.divider()
        st.subheader("💡 AI Insights")
        
        # Generate insights based on data
        insights = []
        
        # HRV insight
        if pd.notna(hrv_val) and hrv_val > 0:
            recent_hrv = health_df.head(7)['hrv_avg'].dropna()
            if len(recent_hrv) >= 3:
                avg_hrv = recent_hrv.mean()
                if hrv_val > avg_hrv * 1.1:
                    insights.append(("🟢", f"Your HRV is {((hrv_val/avg_hrv - 1) * 100):.0f}% above your 7-day average ({avg_hrv:.0f}ms). Excellent recovery!"))
                elif hrv_val < avg_hrv * 0.9:
                    insights.append(("🟡", f"Your HRV is {((1 - hrv_val/avg_hrv) * 100):.0f}% below your 7-day average ({avg_hrv:.0f}ms). Consider lighter training today."))
                else:
                    insights.append(("🟢", f"Your HRV ({hrv_val:.0f}ms) is within normal range. 7-day average: {avg_hrv:.0f}ms."))
        
        # Sleep insight
        if sleep_hrs > 0:
            if sleep_hrs >= 8:
                insights.append(("🟢", f"Great sleep! {sleep_hrs:.1f} hours is optimal for recovery and dive performance."))
            elif sleep_hrs >= 7:
                insights.append(("🟡", f"Decent sleep ({sleep_hrs:.1f}hrs), but aim for 8+ hours for optimal freediving performance."))
            else:
                insights.append(("🔴", f"Low sleep ({sleep_hrs:.1f}hrs). Sleep deprivation reduces breath-hold capacity by up to 20%."))
        
        # Body Battery insight
        if bb_val > 0:
            if bb_val >= 75:
                insights.append(("🟢", f"Body Battery at {bb_val:.0f}% - perfect for dive training!"))
            elif bb_val >= 50:
                insights.append(("🟡", f"Body Battery at {bb_val:.0f}% - moderate training recommended."))
            else:
                insights.append(("🔴", f"Body Battery only {bb_val:.0f}% - prioritize recovery today."))
        
        # Resting HR insight
        resting_hr = latest['resting_hr'] if pd.notna(latest['resting_hr']) else 0
        if resting_hr > 0:
            recent_hr = health_df.head(7)['resting_hr'].dropna()
            if len(recent_hr) >= 3:
                avg_hr = recent_hr.mean()
                if resting_hr > avg_hr + 5:
                    insights.append(("⚠️", f"Resting HR elevated ({resting_hr:.0f} bpm vs {avg_hr:.0f} avg). Sign of stress or incomplete recovery."))
                elif resting_hr < avg_hr - 3:
                    insights.append(("🟢", f"Resting HR is low ({resting_hr:.0f} bpm) - excellent cardiovascular adaptation!"))
        
        # Activity pattern insight
        recent_dives = activities_df[
            (activities_df['activity_type'] == 'apnea_diving') &
            (pd.to_datetime(activities_df['start_time']) >= pd.Timestamp.now() - pd.Timedelta(days=7))
        ]
        
        if len(recent_dives) == 0:
            days_since_last = (pd.Timestamp.now() - pd.to_datetime(activities_df[activities_df['activity_type'] == 'apnea_diving'].iloc[0]['start_time'])).days if len(activities_df) > 0 else 999
            if days_since_last >= 7:
                insights.append(("⚠️", f"It's been {days_since_last} days since your last dive. Regular practice is key for skill retention."))
        elif len(recent_dives) >= 3:
            insights.append(("🟢", f"Great training frequency! {len(recent_dives)} dive sessions in the last 7 days."))
        
        # Display insights
        if insights:
            for icon, insight in insights:
                st.markdown(f"{icon} {insight}")
        else:
            st.info("Keep syncing data to see personalized insights!")
        
        st.divider()
        
        # Recent activity summary
        st.subheader("Recent Activity")
        
        apnea_activities = activities_df[activities_df['activity_type'] == 'apnea_diving']
        
        if len(apnea_activities) > 0:
            col1, col2, col3 = st.columns(3)
            
            with col1:
                st.metric("Total Dive Sessions", len(apnea_activities))
            
            with col2:
                last_dive = apnea_activities.iloc[0]
                days_since = (pd.Timestamp.now() - pd.to_datetime(last_dive['start_time'])).days
                st.metric("Last Dive", f"{days_since} days ago")
            
            with col3:
                avg_duration = apnea_activities['duration'].mean() / 60 if len(apnea_activities) > 0 else 0
                st.metric("Avg Session", f"{avg_duration:.0f} min")
        else:
            st.info("No dive sessions found yet. Sync your watch data!")
        
        # Readiness trend
        st.divider()
        st.subheader("7-Day Readiness Trend")
        
        # Calculate readiness for last 7 days
        recent_health = health_df.head(7)
        readiness_data = []
        
        for _, row in recent_health.iterrows():
            score, _ = calculate_readiness(row)
            readiness_data.append({
                'date': row['date'],
                'readiness': score
            })
        
        if readiness_data:
            readiness_trend = pd.DataFrame(readiness_data)
            
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=readiness_trend['date'],
                y=readiness_trend['readiness'],
                mode='lines+markers',
                name='Readiness',
                line=dict(color='#00D9FF', width=3),
                marker=dict(size=8)
            ))
            
            # Add threshold lines
            fig.add_hline(y=80, line_dash="dash", line_color="green", 
                         annotation_text="High Readiness")
            fig.add_hline(y=60, line_dash="dash", line_color="orange", 
                         annotation_text="Moderate")
            
            fig.update_layout(
                title="Readiness Score Over Time",
                xaxis_title="Date",
                yaxis_title="Readiness (%)",
                yaxis_range=[0, 100],
                height=400,
                hovermode='x unified'
            )
            
            st.plotly_chart(fig, use_container_width=True)

elif page == "🤿 Dive Log":
    st.title("🤿 Dive Log")
    
    apnea_activities = activities_df[activities_df['activity_type'] == 'apnea_diving']
    
    if len(apnea_activities) > 0:
        st.subheader(f"Total Sessions: {len(apnea_activities)}")
        
        # Session cards
        for idx, dive in apnea_activities.iterrows():
            with st.expander(f"📅 {dive['start_time']} - {dive.get('metadata', {})}", expanded=False):
                col1, col2, col3, col4 = st.columns(4)
                
                with col1:
                    duration_min = dive['duration'] / 60 if pd.notna(dive['duration']) else 0
                    st.metric("Duration", f"{duration_min:.0f} min")
                
                with col2:
                    st.metric("Calories", f"{dive['calories']:.0f}" if pd.notna(dive['calories']) else "N/A")
                
                with col3:
                    st.metric("Avg HR", f"{dive['avg_hr']:.0f} bpm" if pd.notna(dive['avg_hr']) else "N/A")
                
                with col4:
                    st.metric("Max HR", f"{dive['max_hr']:.0f} bpm" if pd.notna(dive['max_hr']) else "N/A")
                
                # Show metadata
                if pd.notna(dive['metadata']):
                    try:
                        metadata = json.loads(dive['metadata'])
                        st.json(metadata, expanded=False)
                    except:
                        pass
    else:
        st.info("No dive sessions found. Sync your watch to see dive data!")

elif page == "💓 Health Trends":
    st.title("💓 Health Metrics")
    
    if len(health_df) > 0:
        # Date range selector
        st.subheader("Select Date Range")
        col1, col2 = st.columns(2)
        
        with col1:
            days_back = st.selectbox("Show last", [7, 14, 30], index=1)
        
        recent_health = health_df.head(days_back).sort_values('date')
        
        # HRV Trend
        st.divider()
        st.subheader("Heart Rate Variability (HRV)")
        
        fig_hrv = go.Figure()
        fig_hrv.add_trace(go.Scatter(
            x=recent_health['date'],
            y=recent_health['hrv_avg'],
            mode='lines+markers',
            name='HRV',
            line=dict(color='#FF6B6B', width=2),
            marker=dict(size=6)
        ))
        
        fig_hrv.update_layout(
            xaxis_title="Date",
            yaxis_title="HRV (ms)",
            height=300,
            hovermode='x unified'
        )
        
        st.plotly_chart(fig_hrv, use_container_width=True)
        
        st.caption("💡 Higher HRV = better recovery. Elite freedivers: 70-100ms")
        
        # Sleep Quality
        st.divider()
        st.subheader("Sleep Quality")
        
        fig_sleep = go.Figure()
        fig_sleep.add_trace(go.Bar(
            x=recent_health['date'],
            y=recent_health['sleep_score'],
            name='Sleep Score',
            marker_color='#4ECDC4'
        ))
        
        fig_sleep.update_layout(
            xaxis_title="Date",
            yaxis_title="Sleep Score",
            yaxis_range=[0, 100],
            height=300,
            hovermode='x unified'
        )
        
        st.plotly_chart(fig_sleep, use_container_width=True)
        
        # Body Battery
        st.divider()
        st.subheader("Body Battery & Stress")
        
        fig_bb = go.Figure()
        fig_bb.add_trace(go.Scatter(
            x=recent_health['date'],
            y=recent_health['body_battery_charged'],
            mode='lines+markers',
            name='Body Battery',
            line=dict(color='#95E1D3', width=2)
        ))
        
        fig_bb.add_trace(go.Scatter(
            x=recent_health['date'],
            y=recent_health['stress_avg'],
            mode='lines+markers',
            name='Stress',
            line=dict(color='#F38181', width=2),
            yaxis='y2'
        ))
        
        fig_bb.update_layout(
            xaxis_title="Date",
            yaxis_title="Body Battery (%)",
            yaxis2=dict(
                title="Stress Level",
                overlaying='y',
                side='right'
            ),
            height=300,
            hovermode='x unified'
        )
        
        st.plotly_chart(fig_bb, use_container_width=True)
        
        st.caption("💡 Body Battery 75+ ideal for dive sessions. Lower stress = better performance.")

elif page == "📈 Training":
    st.title("📈 Training Recommendations")
    
    if len(health_df) > 0:
        latest = health_df.iloc[0]
        readiness_score, factors = calculate_readiness(latest)
        
        st.subheader("Today's Training Plan")
        
        # Recommendation based on readiness
        if readiness_score >= 80:
            st.success("### 🎯 High Readiness - Depth Training")
            st.markdown("""
            **Recommended Workout:**
            - 3-4 sets of depth dives
            - Target: 85-90% of your max depth
            - Surface interval: 3 minutes
            - Focus: Relaxation at depth
            
            **Warm-up:**
            - Light CO2 table (4 rounds)
            - Breathing: 2:00 hold / 1:30 rest
            """)
        elif readiness_score >= 60:
            st.info("### 🟡 Moderate Readiness - Technique Work")
            st.markdown("""
            **Recommended Workout:**
            - Dynamic apnea or pool work
            - 5-6 moderate dives
            - Target: 70-80% intensity
            - Focus: Technique refinement
            
            **Alternative:**
            - CO2 tolerance tables
            - Light static apnea
            """)
        else:
            st.warning("### ⚠️ Low Readiness - Active Recovery")
            st.markdown("""
            **Recommended:**
            - Rest day or very light training
            - Yoga / stretching
            - Breathing exercises only
            - Focus: Recovery & sleep
            
            **Why rest matters:**
            - Low HRV indicates incomplete recovery
            - Pushing through increases injury risk
            - One rest day prevents multiple forced rest days
            """)
        
        st.divider()
        
        # Readiness breakdown
        st.subheader("Readiness Breakdown")
        
        if factors:
            factor_df = pd.DataFrame([
                {'Factor': k, 'Score': v} for k, v in factors.items()
            ])
            
            fig = go.Figure(go.Bar(
                x=factor_df['Score'],
                y=factor_df['Factor'],
                orientation='h',
                marker_color=['#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181']
            ))
            
            fig.update_layout(
                xaxis_title="Score",
                xaxis_range=[0, 100],
                height=300
            )
            
            st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("Sync your watch data to get personalized training recommendations!")

# Footer
st.divider()
st.caption("🤿 Garmin Freediving Coach | Data-driven training optimization | HRV-powered readiness")
