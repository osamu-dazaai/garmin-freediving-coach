#!/usr/bin/env python3
"""
Velocity Analyzer - Calculate dive velocities and movement patterns
"""

import numpy as np
from typing import List, Dict, Any


class VelocityAnalyzer:
    """
    Analyze velocity profiles from depth time-series data
    """
    
    def __init__(self, smoothing_window: int = 3):
        """
        Args:
            smoothing_window: Window size for moving average smoothing
        """
        self.smoothing_window = smoothing_window
    
    def analyze(self, dive) -> None:
        """
        Calculate velocities and update dive object in-place
        
        Args:
            dive: Dive object with time_series data
        """
        if not dive.time_series or len(dive.time_series) < 2:
            print(f"⚠️  Dive {dive.dive_number}: Insufficient data for velocity analysis")
            return
        
        # Extract depth and time arrays
        times = np.array([m['time_offset'] for m in dive.time_series])
        depths = np.array([m['depth'] for m in dive.time_series])
        hrs = np.array([m['hr'] if m['hr'] else np.nan for m in dive.time_series])
        
        # Calculate instantaneous velocity (m/s)
        # velocity = change in depth / change in time
        velocities = np.zeros(len(depths))
        
        for i in range(1, len(depths)):
            dt = times[i] - times[i-1]
            if dt > 0:
                # Negative velocity = descending (increasing depth)
                # Positive velocity = ascending (decreasing depth)
                velocities[i] = -(depths[i] - depths[i-1]) / dt
        
        # Smooth velocities to remove noise
        velocities_smooth = self._moving_average(velocities, self.smoothing_window)
        
        # Store in dive object
        dive.velocity_profile = velocities_smooth.tolist()
        dive.hr_profile = hrs.tolist()
        
        # Calculate aggregate metrics
        self._calculate_rates(dive, times, depths, velocities_smooth)
        
        # Calculate velocity statistics
        self._calculate_velocity_stats(dive, velocities_smooth)
    
    def _moving_average(self, data: np.ndarray, window: int) -> np.ndarray:
        """Apply moving average smoothing"""
        if window < 2:
            return data
        
        # Pad edges to avoid boundary effects
        padded = np.pad(data, window//2, mode='edge')
        smoothed = np.convolve(padded, np.ones(window)/window, mode='valid')
        
        return smoothed[:len(data)]
    
    def _calculate_rates(
        self, 
        dive, 
        times: np.ndarray, 
        depths: np.ndarray, 
        velocities: np.ndarray
    ) -> None:
        """Calculate descent and ascent rates"""
        
        # Find max depth index
        max_depth_idx = np.argmax(depths)
        
        # Descent phase (0 to max depth)
        if max_depth_idx > 0:
            descent_velocities = velocities[1:max_depth_idx+1]
            descent_velocities = descent_velocities[descent_velocities < 0]  # Only descending
            
            if len(descent_velocities) > 0:
                dive.descent_rate = abs(np.mean(descent_velocities))
                dive.max_descent_rate = abs(np.min(descent_velocities))  # Most negative = fastest descent
            else:
                dive.descent_rate = 0
                dive.max_descent_rate = 0
        
        # Ascent phase (max depth to surface)
        if max_depth_idx < len(velocities) - 1:
            ascent_velocities = velocities[max_depth_idx:]
            ascent_velocities = ascent_velocities[ascent_velocities > 0]  # Only ascending
            
            if len(ascent_velocities) > 0:
                dive.ascent_rate = abs(np.mean(ascent_velocities))
                dive.max_ascent_rate = abs(np.max(ascent_velocities))
            else:
                dive.ascent_rate = 0
                dive.max_ascent_rate = 0
    
    def _calculate_velocity_stats(self, dive, velocities: np.ndarray) -> None:
        """Calculate velocity variation statistics"""
        
        # Coefficient of variation (for discipline detection)
        non_zero_velocities = velocities[np.abs(velocities) > 0.05]  # Ignore near-zero
        
        if len(non_zero_velocities) > 0:
            velocity_cv = np.std(non_zero_velocities) / np.mean(np.abs(non_zero_velocities))
            dive.velocity_cv = velocity_cv
        else:
            dive.velocity_cv = 0
        
        # Detect rhythmic patterns (for FIM detection)
        # Look for peaks in velocity (pull moments)
        dive.velocity_peaks = self._detect_peaks(velocities)
    
    def _detect_peaks(self, velocities: np.ndarray, threshold: float = 0.1) -> List[int]:
        """
        Detect peaks in velocity profile (for FIM pull detection)
        
        Returns indices of peaks
        """
        peaks = []
        
        for i in range(1, len(velocities) - 1):
            if (abs(velocities[i]) > threshold and 
                abs(velocities[i]) > abs(velocities[i-1]) and 
                abs(velocities[i]) > abs(velocities[i+1])):
                peaks.append(i)
        
        return peaks
    
    def get_buoyancy_indicators(self, dive) -> Dict[str, float]:
        """
        Calculate buoyancy indicators from early dive velocity
        
        Returns:
            Dict with buoyancy metrics
        """
        if not dive.time_series or len(dive.time_series) < 10:
            return {}
        
        depths = np.array([m['depth'] for m in dive.time_series])
        velocities = np.array(dive.velocity_profile)
        
        # Analyze 0-2m zone (buoyancy transition)
        zone_0_2m = (depths >= 0) & (depths <= 2.0)
        zone_2_5m = (depths > 2.0) & (depths <= 5.0)
        
        buoyancy_data = {}
        
        if np.any(zone_0_2m):
            velocities_0_2m = velocities[zone_0_2m]
            velocities_0_2m = velocities_0_2m[velocities_0_2m < 0]  # Descending only
            
            if len(velocities_0_2m) > 0:
                buoyancy_data['avg_velocity_0_2m'] = abs(np.mean(velocities_0_2m))
        
        if np.any(zone_2_5m):
            velocities_2_5m = velocities[zone_2_5m]
            velocities_2_5m = velocities_2_5m[velocities_2_5m < 0]
            
            if len(velocities_2_5m) > 0:
                buoyancy_data['avg_velocity_2_5m'] = abs(np.mean(velocities_2_5m))
        
        # Calculate acceleration (speed increase from 0-2m to 2-5m)
        if 'avg_velocity_0_2m' in buoyancy_data and 'avg_velocity_2_5m' in buoyancy_data:
            buoyancy_data['acceleration'] = (
                buoyancy_data['avg_velocity_2_5m'] - buoyancy_data['avg_velocity_0_2m']
            )
            buoyancy_data['has_buoyancy_struggle'] = buoyancy_data['acceleration'] > 0.1
        
        return buoyancy_data
