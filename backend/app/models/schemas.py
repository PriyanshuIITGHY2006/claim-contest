"""Shared pydantic models.

These mirror the "Data model" block in ``memory-bank/systemPatterns.md`` (JSON
field names are snake_case everywhere). Extra keys present in the sample JSON
(e.g. ``note`` on an expected verdict) are ignored, matching the documented
shapes without failing validation.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


def _paise(value: float) -> int:
    return round(value * 100)


class BillCategory(str, Enum):
    room = "room"
    nursing = "nursing"
    professional_fee = "professional_fee"
    ot = "ot"
    procedure = "procedure"
    pharmacy = "pharmacy"
    consumables = "consumables"
    implant = "implant"
    diagnostics = "diagnostics"
    non_medical = "non_medical"


class VerdictStatus(str, Enum):
    valid = "valid"
    contestable = "contestable"
    needs_info = "needs_info"


class TatEventType(str, Enum):
    cashless_request = "cashless_request"
    cashless_decision = "cashless_decision"
    discharge_request = "discharge_request"
    final_authorisation = "final_authorisation"


class CitationSourceType(str, Enum):
    policy = "policy"
    rule = "rule"


class AnalysisStatus(str, Enum):
    running = "running"
    done = "done"
    error = "error"


class FlagKind(str, Enum):
    tat_breach = "tat_breach"
    letter_not_specific = "letter_not_specific"
    regulation_override = "regulation_override"


class DraftTier(int, Enum):
    tier_1 = 1
    tier_2 = 2
    tier_3 = 3


class DraftLanguage(str, Enum):
    en = "en"
    hi = "hi"
    as_ = "as"


class NpiList(str, Enum):
    room = "room"
    procedure = "procedure"
    treatment = "treatment"
    none = "none"


class BillCheckIssue(str, Enum):
    line_math = "line_math"
    total_mismatch = "total_mismatch"
    duplicate = "duplicate"
    above_price_cap = "above_price_cap"


class AgentEventType(str, Enum):
    step = "step"
    tool_call = "tool_call"
    tool_result = "tool_result"
    verdict = "verdict"
    done = "done"
    error = "error"


class PrecedentOutcome(str, Enum):
    """Best-effort disposition of an Ombudsman award, read from its keywords."""

    allowed = "allowed"
    dismissed = "dismissed"
    partly = "partly"


class BillLine(BaseModel):
    line_id: str
    date: date
    particulars: str
    category: BillCategory
    rate: float
    units: float
    amount: float


class Deduction(BaseModel):
    deduction_id: str
    label: str
    amount: float
    line_ids: list[str]
    insurer_reason: str


class Schedule(BaseModel):
    sum_insured: float
    inception_date: date
    eligible_room_rent_per_day: float | None = None
    continuous_coverage: bool | None = None
    declared_conditions: list[str] | None = None


class PolicyRef(BaseModel):
    doc_id: str
    file: str
    product: str
    uin: str | None = None
    version: str | None = None
    schedule: Schedule


class Patient(BaseModel):
    name: str
    age: int


class Admission(BaseModel):
    hospital: str
    admitted: datetime
    discharged: datetime
    diagnosis: str
    room_category: str
    cashless: bool


class Bill(BaseModel):
    lines: list[BillLine]
    total: float


class Settlement(BaseModel):
    claimed: float
    approved: float
    total_deducted: float
    deductions: list[Deduction]
    letter_text: str


class TatEvent(BaseModel):
    event: TatEventType
    at: datetime


class ExpectedVerdict(BaseModel):
    deduction_id: str
    status: VerdictStatus
    recoverable: float
    basis: list[str]


class Case(BaseModel):
    case_id: str
    title: str
    synthetic_notice: str
    policy: PolicyRef
    patient: Patient
    admission: Admission
    bill: Bill
    settlement: Settlement
    timeline: list[TatEvent]
    expected: list[ExpectedVerdict]


class CaseSummary(BaseModel):
    """Response shape for ``GET /cases`` (systemPatterns.md -> Interfaces)."""

    id: str
    title: str
    summary: str


class CaseDraft(BaseModel):
    """Pre-filled guess from uploaded PDFs (``POST /cases/upload``); never stored."""

    doc_id: str
    claimed: float | None = None
    approved: float | None = None
    deductions: list[Deduction]
    bill_lines: list[BillLine]
    letter_text: str
    warnings: list[str]


class NewCase(BaseModel):
    """The user-confirmed case (``POST /cases``)."""

    doc_id: str
    schedule: Schedule
    patient: Patient
    admission: Admission
    bill_lines: list[BillLine] = Field(min_length=1)
    deductions: list[Deduction] = Field(min_length=1)
    claimed: float = Field(ge=0)
    approved: float = Field(ge=0)
    letter_text: str
    timeline: list[TatEvent] = Field(default_factory=list)

    @model_validator(mode="after")
    def _consistent(self) -> NewCase:
        line_ids = [line.line_id for line in self.bill_lines]
        if len(set(line_ids)) != len(line_ids):
            raise ValueError("bill line ids must be unique")
        deduction_ids = [deduction.deduction_id for deduction in self.deductions]
        if len(set(deduction_ids)) != len(deduction_ids):
            raise ValueError("deduction ids must be unique")
        known = set(line_ids)
        for deduction in self.deductions:
            unknown = [line_id for line_id in deduction.line_ids if line_id not in known]
            if unknown:
                raise ValueError(f"deduction {deduction.deduction_id} refers to unknown bill lines: {unknown}")
        if _paise(self.approved) > _paise(self.claimed):
            raise ValueError("approved amount cannot exceed the claimed amount")
        bill_total = sum(_paise(line.amount) for line in self.bill_lines)
        for deduction in self.deductions:
            if _paise(deduction.amount) > bill_total:
                raise ValueError(f"deduction {deduction.deduction_id} is larger than the bill total")
        return self


class DocumentKind(str, Enum):
    """A registered PDF is either an insurer's policy wording or a regulation."""

    policy = "policy"
    regulation = "regulation"


class DocumentSummary(BaseModel):
    """Registry entry served by ``GET /documents``."""

    doc_id: str
    title: str
    kind: DocumentKind
    pages: int


class PolicySearchRequest(BaseModel):
    """Request body of ``POST /policy/search``."""

    doc_id: str
    query: str
    k: int = Field(default=5, ge=1, le=50)


class Clause(BaseModel):
    clause_id: str
    doc_id: str
    heading: str
    text: str
    page: int


class Rule(BaseModel):
    id: str
    doc: str
    para: str
    page: int
    verified: bool
    ground: str
    text: str
    test: str
    overrides_policy: bool | None = None
    limit_minutes: int | None = None


class Citation(BaseModel):
    source_type: CitationSourceType
    source_id: str
    quote: str
    verified: bool


class RegulationOverride(BaseModel):
    policy_says: str
    law_says: str
    rule_id: str


class Verdict(BaseModel):
    deduction_id: str
    status: VerdictStatus
    recoverable_amount: float
    reasoning: str
    citations: list[Citation]
    calculation: dict[str, Any] | None = None
    confidence: float
    regulation_override: RegulationOverride | None = None
    include_in_grievance: bool | None = None


class PrecedentSearchRequest(BaseModel):
    """Request body of ``POST /precedents/search``."""

    query: str
    k: int = Field(default=3, ge=1, le=50)


class Precedent(BaseModel):
    precedent_id: str
    book: str
    case_no: str
    year: int | None = None
    excerpt: str
    outcome: PrecedentOutcome | None = None
    score: float


class PrecedentDetail(BaseModel):
    """One Ombudsman award with its full text (``GET /precedents/{precedent_id}``)."""

    precedent_id: str
    book: str
    case_no: str
    year: int | None = None
    excerpt: str
    outcome: PrecedentOutcome | None = None
    text: str


class Flag(BaseModel):
    kind: FlagKind
    rule_id: str
    detail: str


class Analysis(BaseModel):
    analysis_id: str
    case_id: str
    status: AnalysisStatus
    verdicts: list[Verdict]
    total_recoverable: float
    flags: list[Flag]
    started_at: datetime | None = None
    finished_at: datetime | None = None


class Draft(BaseModel):
    draft_id: str
    analysis_id: str
    tier: DraftTier
    language: DraftLanguage
    letter_markdown: str
    local_summary: str
    human_approved: bool


class LadderStep(BaseModel):
    tier: int
    stage: str
    earliest: date
    latest: date
    rule_id: str
    completed: bool


class NpiResult(BaseModel):
    line_id: str
    list: NpiList
    matched_item: str | None = None
    payable_separately: bool


class BillCheck(BaseModel):
    line_id: str | None = None
    issue: BillCheckIssue
    expected: float | str | None = None
    found: float | str | None = None


class AgentEvent(BaseModel):
    seq: int
    type: AgentEventType
    message: str
    data: dict[str, Any] | None = None
    at: datetime


class DraftApprovalRequest(BaseModel):
    """Request body of ``PATCH /drafts/{id}`` (the human approval gate)."""

    human_approved: bool


class AnalysisCreated(BaseModel):
    """Response body of ``POST /analyses``."""

    analysis_id: str


class AnalysisSummary(BaseModel):
    """One row of ``GET /analyses``: an analysis without its verdicts and flags."""

    analysis_id: str
    case_id: str
    status: AnalysisStatus
    total_recoverable: float
    finished_at: datetime | None = None

