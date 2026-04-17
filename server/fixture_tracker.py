"""Fixture tracking and deduplication across video frames.

Uses position-based matching to track the same fixture across consecutive frames,
preventing double-counting as the camera moves through the store.
"""

import math
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class TrackedFixture:
    """Represents a unique fixture tracked across multiple frames."""

    def __init__(self, tracking_id: int, fixture_type: str, position: dict,
                 zone: str, confidence: float, occupancy: str, occupancy_pct: float,
                 description: str, frame_index: int, timestamp_sec: float):
        self.tracking_id = tracking_id
        self.fixture_type = fixture_type
        self.positions = [position]
        self.zone = zone
        self.confidences = [confidence]
        self.occupancies = [occupancy]
        self.occupancy_pcts = [occupancy_pct]
        self.descriptions = [description]
        self.frame_indices = [frame_index]
        self.first_seen_sec = timestamp_sec
        self.last_seen_sec = timestamp_sec
        self.best_confidence = confidence
        self.best_frame_index = frame_index
        self.frames_since_last_seen = 0

    @property
    def last_position(self) -> dict:
        return self.positions[-1]

    @property
    def frame_count(self) -> int:
        return len(self.frame_indices)

    @property
    def avg_confidence(self) -> float:
        return sum(self.confidences) / len(self.confidences)

    @property
    def avg_occupancy_pct(self) -> float:
        return sum(self.occupancy_pcts) / len(self.occupancy_pcts)

    @property
    def dominant_occupancy(self) -> str:
        counts = {}
        for o in self.occupancies:
            counts[o] = counts.get(o, 0) + 1
        return max(counts, key=counts.get)

    @property
    def best_description(self) -> str:
        # Return the description from the highest-confidence frame
        best_idx = self.confidences.index(max(self.confidences))
        return self.descriptions[best_idx]

    def update(self, position: dict, confidence: float, occupancy: str,
               occupancy_pct: float, description: str, frame_index: int, timestamp_sec: float):
        self.positions.append(position)
        self.confidences.append(confidence)
        self.occupancies.append(occupancy)
        self.occupancy_pcts.append(occupancy_pct)
        self.descriptions.append(description)
        self.frame_indices.append(frame_index)
        self.last_seen_sec = timestamp_sec
        self.frames_since_last_seen = 0
        if confidence > self.best_confidence:
            self.best_confidence = confidence
            self.best_frame_index = frame_index


class FixtureTracker:
    """Tracks fixtures across frames using position-based matching.

    Algorithm:
    1. For each new frame's detections, try to match with existing tracked fixtures
    2. Match criteria: same fixture type + position within threshold distance
    3. Use nearest-neighbor matching (greedy)
    4. Unmatched detections become new tracked fixtures
    5. Fixtures not seen for N consecutive frames are considered "lost" (still counted)
    """

    def __init__(self, position_threshold: float = 15.0, max_frames_lost: int = 10):
        self.position_threshold = position_threshold
        self.max_frames_lost = max_frames_lost
        self.tracked_fixtures: list[TrackedFixture] = []
        self._next_id = 1

    def process_frame(self, detections: list[dict], frame_index: int, timestamp_sec: float) -> dict[int, int]:
        """Process detections from a single frame.

        Returns:
            mapping of detection_index -> tracking_id
        """
        # Increment frames_since_last_seen for all active tracks
        for tf in self.tracked_fixtures:
            tf.frames_since_last_seen += 1

        # Match detections to existing tracks
        matched_track_ids = set()
        matched_det_ids = set()
        det_to_track = {}

        # Build distance matrix: only consider same-type pairs
        candidates = []
        for di, det in enumerate(detections):
            for ti, tf in enumerate(self.tracked_fixtures):
                if tf.fixture_type == det["type"] and tf.frames_since_last_seen <= self.max_frames_lost:
                    dist = self._position_distance(det["position"], tf.last_position)
                    if dist <= self.position_threshold:
                        candidates.append((dist, di, ti))

        # Greedy matching by shortest distance
        candidates.sort(key=lambda x: x[0])
        for dist, di, ti in candidates:
            if di in matched_det_ids or ti in matched_track_ids:
                continue
            det = detections[di]
            tf = self.tracked_fixtures[ti]
            tf.update(
                position=det["position"],
                confidence=det["confidence"],
                occupancy=det["occupancy"],
                occupancy_pct=det["occupancy_pct"],
                description=det["description"],
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
            )
            matched_track_ids.add(ti)
            matched_det_ids.add(di)
            det_to_track[di] = tf.tracking_id

        # Create new tracks for unmatched detections
        for di, det in enumerate(detections):
            if di in matched_det_ids:
                continue
            tf = TrackedFixture(
                tracking_id=self._next_id,
                fixture_type=det["type"],
                position=det["position"],
                zone=det["zone"],
                confidence=det["confidence"],
                occupancy=det["occupancy"],
                occupancy_pct=det["occupancy_pct"],
                description=det["description"],
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
            )
            self.tracked_fixtures.append(tf)
            det_to_track[di] = self._next_id
            self._next_id += 1

        return det_to_track

    def get_unique_fixtures(self, min_frames: int = 1) -> list[TrackedFixture]:
        """Get deduplicated fixture list.

        Args:
            min_frames: minimum number of frames a fixture must appear in to be counted
        """
        return [tf for tf in self.tracked_fixtures if tf.frame_count >= min_frames]

    def get_summary(self) -> dict[str, int]:
        """Get fixture count by type."""
        fixtures = self.get_unique_fixtures()
        summary = {}
        for tf in fixtures:
            summary[tf.fixture_type] = summary.get(tf.fixture_type, 0) + 1
        return summary

    @staticmethod
    def _position_distance(pos1: dict, pos2: dict) -> float:
        dx = pos1.get("x", 50) - pos2.get("x", 50)
        dy = pos1.get("y", 50) - pos2.get("y", 50)
        return math.sqrt(dx * dx + dy * dy)
