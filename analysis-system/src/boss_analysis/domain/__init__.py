"""Domain models for the analysis system."""

from boss_analysis.domain.events import NormalizedEvent, ParseIssue, ParseStatus
from boss_analysis.domain.facts import (
  CandidateChatFact,
  CandidateDetailSessionFact,
  CandidateExposureFact,
  CandidateGreetingFact,
  CandidateIdentityFact,
  FactProjectionResult,
)
from boss_analysis.domain.ingestion import IngestionResult
from boss_analysis.domain.metrics import (
  ActiveOperatorSummary,
  ChatSummary,
  DashboardSummary,
  FunnelSummary,
  HealthSummary,
  LogQualityEventSummary,
  LogQualityIssueCounter,
  LogQualityQueryResult,
  LogQualityVersionSummary,
  OperatorAnalytics,
  OperatorMinutePoint,
)
from boss_analysis.domain.operations import AppSettings, ProcessRole, RuntimeHealth
from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.storage import (
  ErrorStage,
  EventErrorRecord,
  RawEventRecord,
  RawEventRepository,
  RawEventSaveResult,
  ReplayFilter,
)
from boss_analysis.domain.summary import DailyActiveDurationRecord
from boss_analysis.domain.summary import LogQualitySummaryRecord
from boss_analysis.domain.summary import MinuteSummaryRecord

__all__ = [
  "ActiveOperatorSummary",
  "AppSettings",
  "CandidateChatFact",
  "CandidateDetailSessionFact",
  "CandidateExposureFact",
  "CandidateGreetingFact",
  "CandidateIdentityFact",
  "ChatSummary",
  "DailyActiveDurationRecord",
  "DashboardSummary",
  "ErrorStage",
  "EventErrorRecord",
  "FactProjectionResult",
  "FunnelSummary",
  "HealthSummary",
  "IngestionResult",
  "LogQualitySummaryRecord",
  "LogQualityEventSummary",
  "LogQualityIssueCounter",
  "LogQualityQueryResult",
  "LogQualityVersionSummary",
  "MinuteSummaryRecord",
  "NormalizedEvent",
  "OperatorAnalytics",
  "OperatorMinutePoint",
  "OperatorProfile",
  "ParseIssue",
  "ParseStatus",
  "ProcessRole",
  "RawEventRecord",
  "RawEventRepository",
  "RawEventSaveResult",
  "ReplayFilter",
  "RuntimeHealth",
]
