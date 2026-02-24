#!/usr/bin/env python3
"""
Discipline Detector - Classify dive discipline (FIM/CWT/CNF)
"""

import numpy as np
from typing import Dict, Tuple, Optional


class DisciplineDetector:
    """
    Detect freediving discipline based on velocity patterns
    """
    
    def __init__(self):
        # Baseline thresholds (will be personalized per user)
        self.fim_cv_threshold = 0.25  # High velocity variation
        self.cnf_cv_threshold = 0.20  # Very low variation
        self.cwt_speed_threshold = 0.6  # m/s - faster descent
        
    def detect(self, dive, user_baseline: Optional[Dict] = None) -> Tuple[str, float, Dict]:
        """
        Detect discipline with confidence score
        
        Args:
            dive: Dive object with velocity analysis
            user_baseline: Optional user baseline data
            
        Returns:
            (discipline, confidence, evidence_dict)
        """
        if not hasattr(dive, 'velocity_cv') or not dive.descent_rate:
            return ('unknown', 0.0, {'reason': 'insufficient_data'})
        
        evidence = {}
        scores = {
            'FIM': 0.0,
            'CWT': 0.0,
            'CNF': 0.0
        }
        
        # Signal 1: Velocity Variation (strongest signal)
        cv = dive.velocity_cv
        evidence['velocity_cv'] = cv
        
        if cv > self.fim_cv_threshold:
            scores['FIM'] += 40
            evidence['fim_cv_match'] = True
        elif cv < self.cnf_cv_threshold:
            scores['CNF'] += 40
            evidence['cnf_cv_match'] = True
        else:
            scores['CWT'] += 30  # Medium variation = fins
            evidence['cwt_cv_match'] = True
        
        # Signal 2: Descent Rate
        descent_rate = dive.descent_rate
        evidence['descent_rate'] = descent_rate
        
        if descent_rate > self.cwt_speed_threshold:
            scores['CWT'] += 30
            evidence['high_speed'] = True
        elif descent_rate < 0.4:
            scores['CNF'] += 25  # Slow = no fins
            evidence['slow_speed'] = True
        else:
            scores['FIM'] += 20  # Medium speed
        
        # Signal 3: Rhythmic Pattern (FIM pulls)
        if hasattr(dive, 'velocity_peaks') and len(dive.velocity_peaks) >= 3:
            intervals = np.diff(dive.velocity_peaks)
            
            if len(intervals) > 0:
                avg_interval = np.mean(intervals)
                std_interval = np.std(intervals)
                
                # Consistent rhythm (2-4s pull interval)
                if 2.0 <= avg_interval <= 4.5 and std_interval < 2.0:
                    scores['FIM'] += 30
                    evidence['fim_rhythm'] = {
                        'pull_count': len(dive.velocity_peaks),
                        'avg_interval': float(avg_interval),
                        'std_interval': float(std_interval)
                    }
        
        # Signal 4: Max Descent Rate (CWT has spikes)
        if hasattr(dive, 'max_descent_rate'):
            max_rate = dive.max_descent_rate
            evidence['max_descent_rate'] = max_rate
            
            if max_rate > 1.0:
                scores['CWT'] += 10  # Powerful fin kicks
        
        # Apply user baseline adjustments
        if user_baseline:
            scores = self._apply_baseline(scores, dive, user_baseline, evidence)
        
        # Determine discipline and confidence
        max_score = max(scores.values())
        discipline = max(scores, key=scores.get)
        
        # Normalize confidence to 0-100
        total_possible = 100
        confidence = min(100, (max_score / total_possible) * 100)
        
        # Require minimum score for confident classification
        if max_score < 40:
            discipline = 'unknown'
            confidence = max_score  # Low confidence
        
        evidence['scores'] = scores
        
        return (discipline, confidence, evidence)
    
    def _apply_baseline(
        self, 
        scores: Dict, 
        dive, 
        baseline: Dict, 
        evidence: Dict
    ) -> Dict:
        """Apply user-specific baseline adjustments"""
        
        # Compare to user's known patterns
        if 'disciplines' in baseline:
            user_disciplines = baseline['disciplines']
            
            # Check if descent rate matches user's typical FIM/CWT/CNF
            for disc, disc_data in user_disciplines.items():
                if 'avg_descent_rate' in disc_data:
                    user_rate = disc_data['avg_descent_rate']
                    rate_diff = abs(dive.descent_rate - user_rate)
                    
                    # Within 20% of user's typical rate
                    if rate_diff < user_rate * 0.2:
                        scores[disc] += 15
                        evidence[f'{disc.lower()}_rate_match'] = True
        
        return scores


class LungVolumeDetector:
    """
    Detect lung volume (Full/FRC/Exhale) based on HR and buoyancy
    """
    
    def __init__(self):
        # Default thresholds
        self.frc_hr_diff_threshold = -8  # 8+ bpm below baseline = FRC
        self.exhale_hr_diff_threshold = -18  # 18+ bpm below = exhale
        self.buoyancy_acceleration_threshold = 0.1  # m/s²
        
    def detect(
        self, 
        dive, 
        session_avg_hr: float,
        user_baseline: Optional[Dict] = None
    ) -> Tuple[str, float, Dict]:
        """
        Detect lung volume with confidence
        
        Args:
            dive: Dive object with phases and HR data
            session_avg_hr: Average HR across session (for comparison)
            user_baseline: Optional user baseline
            
        Returns:
            (lung_volume, confidence, evidence_dict)
        """
        if not dive.avg_hr:
            return ('unknown', 0.0, {'reason': 'no_hr_data'})
        
        evidence = {}
        scores = {
            'full': 0.0,
            'frc': 0.0,
            'exhale': 0.0
        }
        
        # Signal 1: HR Difference from Session Average (STRONGEST)
        hr_diff = dive.avg_hr - session_avg_hr
        evidence['hr_diff_from_avg'] = hr_diff
        evidence['dive_avg_hr'] = dive.avg_hr
        evidence['session_avg_hr'] = session_avg_hr
        
        if hr_diff < self.exhale_hr_diff_threshold:
            scores['exhale'] += 50
            evidence['very_low_hr'] = True
        elif hr_diff < self.frc_hr_diff_threshold:
            scores['frc'] += 50
            evidence['low_hr'] = True
        elif hr_diff > 5:
            scores['full'] += 40
            evidence['high_hr'] = True
        else:
            scores['full'] += 20  # Slight elevation = likely full
        
        # Signal 2: HR Consistency (FRC/Exhale = very stable)
        if dive.max_hr and dive.min_hr:
            hr_range = dive.max_hr - dive.min_hr
            evidence['hr_range'] = hr_range
            
            if hr_range < 10:
                scores['frc'] += 20
                scores['exhale'] += 20
                evidence['stable_hr'] = True
            elif hr_range > 20:
                scores['full'] += 15
                evidence['variable_hr'] = True
        
        # Signal 3: Buoyancy Indicators
        from velocity_analyzer import VelocityAnalyzer
        va = VelocityAnalyzer()
        buoyancy = va.get_buoyancy_indicators(dive)
        
        if buoyancy:
            evidence['buoyancy'] = buoyancy
            
            if 'has_buoyancy_struggle' in buoyancy and buoyancy['has_buoyancy_struggle']:
                scores['full'] += 25
                evidence['positive_buoyancy'] = True
            
            if 'acceleration' in buoyancy:
                accel = buoyancy['acceleration']
                
                if accel < 0.05:  # Minimal acceleration
                    scores['frc'] += 15
                    scores['exhale'] += 10
                    evidence['neutral_buoyancy'] = True
                
                # Fast initial descent (negative buoyancy)
                if 'avg_velocity_0_2m' in buoyancy:
                    v_initial = buoyancy['avg_velocity_0_2m']
                    
                    if v_initial > 0.3:  # Fast start
                        scores['exhale'] += 20
                        evidence['fast_initial_descent'] = True
        
        # Signal 4: Bottom Phase HR (if available)
        if dive.phases and 'bottom' in dive.phases:
            bottom_hr = dive.phases['bottom'].get('avg_hr')
            
            if bottom_hr:
                evidence['bottom_hr'] = bottom_hr
                
                # Very low HR at depth = FRC/Exhale
                if bottom_hr < session_avg_hr * 0.85:
                    scores['frc'] += 15
                    scores['exhale'] += 10
                
                # Mammalian dive reflex strength
                if dive.phases['bottom'].get('min_hr'):
                    min_hr_bottom = dive.phases['bottom']['min_hr']
                    
                    if min_hr_bottom < session_avg_hr * 0.75:
                        scores['exhale'] += 15
                        evidence['strong_dive_reflex'] = True
        
        # Signal 5: Dive Duration (more O2 in full lung)
        if dive.bottom_time:
            evidence['bottom_time'] = dive.bottom_time
            
            # This is weak signal, only use as tiebreaker
            # Full lung typically = longer bottom time at same depth
        
        # Apply user baseline
        if user_baseline:
            scores = self._apply_baseline(scores, dive, user_baseline, evidence)
        
        # Determine lung volume and confidence
        max_score = max(scores.values())
        lung_volume = max(scores, key=scores.get)
        
        # Normalize confidence
        total_possible = 100
        confidence = min(100, (max_score / total_possible) * 100)
        
        # Require minimum score
        if max_score < 40:
            lung_volume = 'unknown'
            confidence = max_score
        
        evidence['scores'] = scores
        
        return (lung_volume, confidence, evidence)
    
    def _apply_baseline(
        self,
        scores: Dict,
        dive,
        baseline: Dict,
        evidence: Dict
    ) -> Dict:
        """Apply user baseline adjustments"""
        
        if 'lung_volumes' in baseline:
            user_lungs = baseline['lung_volumes']
            
            # Compare to user's typical HR for each lung volume
            for lung, lung_data in user_lungs.items():
                if 'avg_hr' in lung_data:
                    user_hr = lung_data['avg_hr']
                    hr_diff = abs(dive.avg_hr - user_hr)
                    
                    # Within 10% of user's typical HR for this lung volume
                    if hr_diff < user_hr * 0.1:
                        scores[lung] += 20
                        evidence[f'{lung}_hr_match'] = True
        
        return scores


def analyze_and_classify_dive(
    dive,
    session_avg_hr: float,
    user_baseline: Optional[Dict] = None
) -> Dict:
    """
    Complete classification of a single dive
    
    Returns:
        Dict with discipline and lung volume classifications
    """
    discipline_detector = DisciplineDetector()
    lung_detector = LungVolumeDetector()
    
    # Detect discipline
    discipline, disc_conf, disc_evidence = discipline_detector.detect(dive, user_baseline)
    
    # Detect lung volume
    lung_vol, lung_conf, lung_evidence = lung_detector.detect(
        dive, session_avg_hr, user_baseline
    )
    
    return {
        'discipline': {
            'value': discipline,
            'confidence': disc_conf,
            'evidence': disc_evidence
        },
        'lung_volume': {
            'value': lung_vol,
            'confidence': lung_conf,
            'evidence': lung_evidence
        }
    }
