"""
Baseline Manager - Learn user-specific patterns for dive classification

This module handles:
1. Calculating personal baselines from labeled dives
2. Updating baselines as more data arrives
3. Providing confidence scores
4. Managing calibration state
"""

import sqlite3
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import statistics


class BaselineManager:
    """Manages user baselines for personalized dive classification"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
    
    def get_user_profile(self, username: str = "neko") -> Optional[Dict]:
        """Get user profile with current baselines"""
        cursor = self.conn.execute(
            "SELECT * FROM user_profiles WHERE username = ?",
            (username,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    
    def get_labeled_dives(self, user_id: int, 
                         discipline: Optional[str] = None,
                         lung_volume: Optional[str] = None) -> List[Dict]:
        """Get all labeled dives for baseline calculation"""
        query = """
            SELECT * FROM dive_sessions_enhanced 
            WHERE user_id = ? 
            AND (manual_discipline IS NOT NULL OR manual_lung_volume IS NOT NULL)
        """
        params = [user_id]
        
        if discipline:
            query += " AND final_discipline = ?"
            params.append(discipline)
        
        if lung_volume:
            query += " AND final_lung_volume = ?"
            params.append(lung_volume)
        
        query += " ORDER BY start_time"
        
        cursor = self.conn.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]
    
    def calculate_baselines(self, user_id: int) -> Dict:
        """Calculate all baselines from labeled dives"""
        baselines = {}
        
        # Get all labeled dives
        all_dives = self.get_labeled_dives(user_id)
        
        if not all_dives:
            return {"error": "No labeled dives found", "calibration_dives": 0}
        
        # HR baselines by lung volume
        for lung_type in ['full', 'frc', 'exhale']:
            dives = self.get_labeled_dives(user_id, lung_volume=lung_type)
            if dives:
                hr_values = [d['avg_hr'] for d in dives if d['avg_hr']]
                if hr_values:
                    baselines[f'baseline_hr_{lung_type}_lung'] = {
                        'mean': statistics.mean(hr_values),
                        'stdev': statistics.stdev(hr_values) if len(hr_values) > 1 else 0,
                        'count': len(hr_values),
                        'min': min(hr_values),
                        'max': max(hr_values)
                    }
        
        # Descent rate baselines by discipline
        for discipline in ['fim', 'cwt', 'cnf']:
            dives = self.get_labeled_dives(user_id, discipline=discipline.upper())
            if dives:
                descent_rates = [d['avg_descent_rate'] for d in dives if d['avg_descent_rate']]
                if descent_rates:
                    baselines[f'baseline_descent_{discipline}'] = {
                        'mean': statistics.mean(descent_rates),
                        'stdev': statistics.stdev(descent_rates) if len(descent_rates) > 1 else 0,
                        'count': len(descent_rates),
                        'min': min(descent_rates),
                        'max': max(descent_rates)
                    }
        
        # Resting HR from health metrics (if available)
        cursor = self.conn.execute(
            "SELECT AVG(resting_hr) as avg_resting FROM health_metrics WHERE resting_hr IS NOT NULL"
        )
        row = cursor.fetchone()
        if row and row['avg_resting']:
            baselines['baseline_hr_resting'] = {
                'mean': row['avg_resting'],
                'count': 1  # Using aggregate
            }
        
        baselines['calibration_dives'] = len(all_dives)
        baselines['last_update'] = datetime.now().isoformat()
        
        return baselines
    
    def update_user_baselines(self, username: str = "neko") -> Tuple[bool, str]:
        """
        Recalculate and update user baselines
        
        Returns:
            (success: bool, message: str)
        """
        # Get user
        user = self.get_user_profile(username)
        if not user:
            return False, f"User '{username}' not found"
        
        user_id = user['id']
        
        # Calculate new baselines
        baselines = self.calculate_baselines(user_id)
        
        if 'error' in baselines:
            return False, baselines['error']
        
        calibration_dives = baselines.pop('calibration_dives')
        last_update = baselines.pop('last_update')
        
        # Determine if calibration is complete (20+ labeled dives)
        calibration_complete = calibration_dives >= 20
        
        # Update user_profiles table
        update_fields = []
        update_values = []
        
        for key, stats in baselines.items():
            if key.startswith('baseline_'):
                update_fields.append(f"{key} = ?")
                update_values.append(stats['mean'])
        
        update_fields.append("calibration_dives = ?")
        update_values.append(calibration_dives)
        
        update_fields.append("calibration_complete = ?")
        update_values.append(calibration_complete)
        
        update_fields.append("last_calibration_date = ?")
        update_values.append(last_update)
        
        update_fields.append("updated_at = ?")
        update_values.append(datetime.now().isoformat())
        
        update_values.append(user_id)
        
        query = f"""
            UPDATE user_profiles 
            SET {', '.join(update_fields)}
            WHERE id = ?
        """
        
        self.conn.execute(query, update_values)
        
        # Store baseline history
        self.conn.execute(
            """
            INSERT INTO baseline_updates (user_id, dives_analyzed, baseline_data, confidence_score, data_quality)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user_id,
                calibration_dives,
                json.dumps(baselines, indent=2),
                self._calculate_confidence(calibration_dives, baselines),
                self._assess_data_quality(calibration_dives, baselines)
            )
        )
        
        self.conn.commit()
        
        status = "complete" if calibration_complete else "in progress"
        return True, f"Baselines updated! {calibration_dives} dives analyzed. Calibration {status}."
    
    def _calculate_confidence(self, dive_count: int, baselines: Dict) -> float:
        """
        Calculate confidence score (0-100) based on:
        - Number of labeled dives
        - Consistency of data (low stdev = high confidence)
        - Coverage (how many baselines calculated)
        """
        confidence = 0.0
        
        # Dive count score (0-50 points)
        # 0 dives = 0%, 20 dives = 50%
        confidence += min(50, (dive_count / 20) * 50)
        
        # Consistency score (0-30 points)
        # Low stdev relative to mean = high consistency
        consistency_scores = []
        for key, stats in baselines.items():
            if 'stdev' in stats and 'mean' in stats and stats['mean'] > 0:
                cv = stats['stdev'] / stats['mean']  # Coefficient of variation
                consistency = max(0, 1 - cv)  # Lower CV = higher consistency
                consistency_scores.append(consistency)
        
        if consistency_scores:
            confidence += statistics.mean(consistency_scores) * 30
        
        # Coverage score (0-20 points)
        # More baselines = better coverage
        expected_baselines = 6  # 3 HR + 3 descent rates
        actual = len([k for k in baselines.keys() if k.startswith('baseline_')])
        confidence += (actual / expected_baselines) * 20
        
        return round(confidence, 1)
    
    def _assess_data_quality(self, dive_count: int, baselines: Dict) -> str:
        """Assess overall data quality"""
        if dive_count < 5:
            return "poor"
        elif dive_count < 10:
            return "fair"
        elif dive_count < 20:
            return "good"
        else:
            # Check if we have most baselines
            baseline_count = len([k for k in baselines.keys() if k.startswith('baseline_')])
            if baseline_count >= 5:
                return "excellent"
            else:
                return "good"
    
    def get_baseline_for_comparison(self, user_id: int, 
                                    metric_type: str,
                                    category: Optional[str] = None) -> Optional[float]:
        """
        Get a specific baseline value for comparison
        
        Args:
            user_id: User ID
            metric_type: 'hr' or 'descent_rate'
            category: For HR: 'full', 'frc', 'exhale', 'resting'
                     For descent: 'fim', 'cwt', 'cnf'
        
        Returns:
            Baseline mean value or None
        """
        user = self.conn.execute(
            "SELECT * FROM user_profiles WHERE id = ?",
            (user_id,)
        ).fetchone()
        
        if not user:
            return None
        
        if metric_type == 'hr' and category:
            field = f'baseline_hr_{category}_lung' if category != 'resting' else 'baseline_hr_resting'
            return user[field]
        
        elif metric_type == 'descent_rate' and category:
            field = f'baseline_descent_{category}'
            return user[field]
        
        return None
    
    def needs_calibration(self, username: str = "neko") -> bool:
        """Check if user needs more calibration dives"""
        user = self.get_user_profile(username)
        if not user:
            return True
        
        return not user['calibration_complete']
    
    def get_calibration_progress(self, username: str = "neko") -> Dict:
        """Get calibration progress info"""
        user = self.get_user_profile(username)
        if not user:
            return {"error": "User not found"}
        
        dive_count = user['calibration_dives']
        complete = user['calibration_complete']
        
        # Count by category
        cursor = self.conn.execute(
            """
            SELECT 
                final_discipline,
                final_lung_volume,
                COUNT(*) as count
            FROM dive_sessions_enhanced
            WHERE user_id = ?
            AND (manual_discipline IS NOT NULL OR manual_lung_volume IS NOT NULL)
            GROUP BY final_discipline, final_lung_volume
            """,
            (user['id'],)
        )
        
        breakdown = {}
        for row in cursor.fetchall():
            disc = row['final_discipline'] or 'unknown'
            lung = row['final_lung_volume'] or 'unknown'
            key = f"{disc}_{lung}"
            breakdown[key] = row['count']
        
        return {
            "total_labeled": dive_count,
            "target": 20,
            "complete": complete,
            "progress_percent": min(100, (dive_count / 20) * 100),
            "breakdown": breakdown,
            "message": self._calibration_message(dive_count, complete)
        }
    
    def _calibration_message(self, dive_count: int, complete: bool) -> str:
        """Generate user-friendly calibration message"""
        if complete:
            return f"✅ Calibration complete! ({dive_count} dives) Auto-detection enabled."
        elif dive_count == 0:
            return "🎯 Let's build your baseline! Label your next 20 dives."
        elif dive_count < 10:
            return f"📊 Building baseline... {dive_count}/20 dives labeled. Keep going!"
        else:
            remaining = 20 - dive_count
            return f"🔥 Almost there! Just {remaining} more dives to complete calibration."
    
    def close(self):
        """Close database connection"""
        self.conn.close()


# CLI for testing
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python baseline_manager.py <db_path>")
        sys.exit(1)
    
    db_path = sys.argv[1]
    manager = BaselineManager(db_path)
    
    # Show calibration progress
    progress = manager.get_calibration_progress()
    print(f"\n{progress['message']}")
    print(f"Progress: {progress['progress_percent']:.0f}%")
    
    if progress['breakdown']:
        print("\nDive breakdown:")
        for combo, count in progress['breakdown'].items():
            print(f"  {combo}: {count} dives")
    
    # Update baselines
    print("\nUpdating baselines...")
    success, message = manager.update_user_baselines()
    print(message)
    
    if success:
        # Show current baselines
        user = manager.get_user_profile()
        print("\nCurrent baselines:")
        for key, value in user.items():
            if key.startswith('baseline_') and value:
                print(f"  {key}: {value:.2f}")
    
    manager.close()
