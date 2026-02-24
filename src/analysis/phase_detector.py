#!/usr/bin/env python3
"""
Phase Detector - Identify dive phases (descent, bottom, ascent, surface)
"""

import numpy as np
from typing import Dict, Any, Optional


class PhaseDetector:
    """
    Detect and classify dive phases from time-series data
    """
    
    def __init__(
        self, 
        bottom_depth_threshold: float = 0.8,  # 80% of max depth
        bottom_time_threshold: float = 3.0     # Min 3s at depth
    ):
        """
        Args:
            bottom_depth_threshold: % of max depth to be considered "at bottom"
            bottom_time_threshold: Minimum time at depth to count as bottom phase
        """
        self.bottom_depth_threshold = bottom_depth_threshold
        self.bottom_time_threshold = bottom_time_threshold
    
    def detect(self, dive) -> None:
        """
        Detect phases and update dive object in-place
        
        Args:
            dive: Dive object with time_series and velocity_profile
        """
        if not dive.time_series or len(dive.time_series) < 3:
            dive.phases = None
            return
        
        times = np.array([m['time_offset'] for m in dive.time_series])
        depths = np.array([m['depth'] for m in dive.time_series])
        velocities = np.array(dive.velocity_profile) if dive.velocity_profile else np.zeros(len(depths))
        hrs = np.array([m['hr'] if m['hr'] else np.nan for m in dive.time_series])
        
        # Find phase boundaries
        max_depth_idx = np.argmax(depths)
        max_depth = depths[max_depth_idx]
        bottom_threshold = max_depth * self.bottom_depth_threshold
        
        # Descent: Start to first time reaching bottom threshold
        descent_end_idx = np.where(depths >= bottom_threshold)[0]
        descent_end_idx = descent_end_idx[0] if len(descent_end_idx) > 0 else max_depth_idx
        
        # Bottom: Time spent near max depth
        at_bottom = depths >= bottom_threshold
        bottom_start_idx = descent_end_idx
        
        # Find where we leave the bottom (descending depth back to threshold)
        leaving_bottom = np.where(~at_bottom & (np.arange(len(at_bottom)) > max_depth_idx))[0]
        bottom_end_idx = leaving_bottom[0] if len(leaving_bottom) > 0 else len(depths) - 1
        
        # Ascent: Bottom to surface
        ascent_start_idx = bottom_end_idx
        
        # Calculate phase metrics
        phases = {}
        
        # DESCENT PHASE
        if descent_end_idx > 0:
            phases['descent'] = self._analyze_phase(
                'descent',
                times[:descent_end_idx+1],
                depths[:descent_end_idx+1],
                velocities[:descent_end_idx+1],
                hrs[:descent_end_idx+1]
            )
        
        # BOTTOM PHASE
        if bottom_end_idx > bottom_start_idx:
            phases['bottom'] = self._analyze_phase(
                'bottom',
                times[bottom_start_idx:bottom_end_idx+1],
                depths[bottom_start_idx:bottom_end_idx+1],
                velocities[bottom_start_idx:bottom_end_idx+1],
                hrs[bottom_start_idx:bottom_end_idx+1]
            )
        
        # ASCENT PHASE
        if ascent_start_idx < len(depths) - 1:
            phases['ascent'] = self._analyze_phase(
                'ascent',
                times[ascent_start_idx:],
                depths[ascent_start_idx:],
                velocities[ascent_start_idx:],
                hrs[ascent_start_idx:]
            )
        
        dive.phases = phases
        
        # Also calculate min HR (usually at bottom)
        valid_hrs = hrs[~np.isnan(hrs)]
        if len(valid_hrs) > 0:
            dive.min_hr = float(np.min(valid_hrs))
    
    def _analyze_phase(
        self,
        phase_name: str,
        times: np.ndarray,
        depths: np.ndarray,
        velocities: np.ndarray,
        hrs: np.ndarray
    ) -> Dict[str, Any]:
        """Analyze a single phase and return metrics"""
        
        if len(times) < 2:
            return {}
        
        phase_data = {
            'duration': float(times[-1] - times[0]),
            'start_depth': float(depths[0]),
            'end_depth': float(depths[-1]),
            'max_depth': float(np.max(depths)),
            'avg_depth': float(np.mean(depths)),
        }
        
        # Velocity stats
        valid_velocities = velocities[np.abs(velocities) > 0.01]
        if len(valid_velocities) > 0:
            phase_data['avg_velocity'] = float(np.mean(np.abs(valid_velocities)))
            phase_data['max_velocity'] = float(np.max(np.abs(valid_velocities)))
        
        # HR stats
        valid_hrs = hrs[~np.isnan(hrs)]
        if len(valid_hrs) > 0:
            phase_data['avg_hr'] = float(np.mean(valid_hrs))
            phase_data['min_hr'] = float(np.min(valid_hrs))
            phase_data['max_hr'] = float(np.max(valid_hrs))
            
            # HR change during phase
            if len(valid_hrs) >= 2:
                phase_data['hr_change'] = float(valid_hrs[-1] - valid_hrs[0])
        
        return phase_data
    
    def detect_dive_type_hints(self, dive) -> Dict[str, Any]:
        """
        Provide hints about dive type based on phase characteristics
        
        Returns:
            Dict with hints for discipline and lung volume classification
        """
        if not dive.phases:
            return {}
        
        hints = {}
        
        # Discipline hints from descent pattern
        if 'descent' in dive.phases:
            descent = dive.phases['descent']
            
            # Check for velocity variation (FIM indicator)
            if hasattr(dive, 'velocity_cv'):
                if dive.velocity_cv > 0.3:
                    hints['discipline_hint'] = 'FIM (high velocity variation)'
                elif dive.velocity_cv < 0.15:
                    hints['discipline_hint'] = 'CNF (very smooth)'
                elif dive.descent_rate and dive.descent_rate > 0.7:
                    hints['discipline_hint'] = 'CWT (high speed)'
            
            # Check for rhythmic pulls (FIM)
            if hasattr(dive, 'velocity_peaks') and len(dive.velocity_peaks) >= 3:
                intervals = np.diff(dive.velocity_peaks)
                if len(intervals) > 0 and np.std(intervals) < 2.0:
                    hints['fim_rhythm_detected'] = True
                    hints['pull_interval'] = float(np.mean(intervals))
        
        # Lung volume hints from HR and buoyancy
        if dive.avg_hr and dive.min_hr:
            hr_drop = dive.avg_hr - dive.min_hr
            
            if dive.min_hr < dive.avg_hr * 0.85:
                hints['lung_volume_hint'] = 'FRC or Exhale (low HR)'
            elif hr_drop < 5:
                hints['lung_volume_hint'] = 'Full lung (minimal HR drop)'
        
        return hints
