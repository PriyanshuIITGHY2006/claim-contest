"""Deterministic calculator endpoints.

Routes stay thin; logic lives in ``services/calculators.py``. Request and
response models for these endpoints are defined here.
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

from app.models.schemas import BillCategory, BillLine
from app.services import calculators

router = APIRouter()


class PerLineDeduction(BaseModel):
    line_id: str
    category: BillCategory
    associated: bool
    deduction: float


class InsurerDeduction(BaseModel):
    amount: float = Field(ge=0)
    line_ids: list[str]


class ProportionateRequest(BaseModel):
    eligible_room_rent: float = Field(ge=0)
    actual_room_rent: float = Field(gt=0)
    days: int = Field(gt=0)
    lines: list[BillLine]
    exempt_categories: list[str] | None = None
    deduction: InsurerDeduction | None = None

    @model_validator(mode="after")
    def _deduction_lines_exist(self) -> ProportionateRequest:
        if self.deduction is not None:
            known = {line.line_id for line in self.lines}
            unknown = [i for i in self.deduction.line_ids if i not in known]
            if unknown:
                raise ValueError(f"deduction refers to unknown bill lines: {unknown}")
        return self


class ProportionateResponse(BaseModel):
    ratio: float
    room_difference: float
    associated_total: float
    exempt_total: float
    correct_deduction: float
    per_line: list[PerLineDeduction]
    recoverable_amount: float | None = None


class WaitingPeriodRequest(BaseModel):
    inception_date: date
    event_date: date
    policy_months: int = Field(gt=0)
    regulation_months: int | None = None

    @model_validator(mode="after")
    def _event_not_before_inception(self) -> WaitingPeriodRequest:
        if self.event_date < self.inception_date:
            raise ValueError("event_date must not be before inception_date")
        return self


class WaitingPeriodResponse(BaseModel):
    months_completed: int
    applicable_months: int
    elapsed: bool
    overridden: bool


class TatRequest(BaseModel):
    requested_at: datetime
    decided_at: datetime
    limit_minutes: int = Field(gt=0)

    @model_validator(mode="after")
    def _decided_not_before_requested(self) -> TatRequest:
        if (self.requested_at.tzinfo is None) != (self.decided_at.tzinfo is None):
            raise ValueError(
                "requested_at and decided_at must both have a time zone or neither"
            )
        if self.decided_at < self.requested_at:
            raise ValueError("decided_at must not be before requested_at")
        return self


class TatResponse(BaseModel):
    elapsed_minutes: int
    limit_minutes: int
    breached: bool
    over_by_minutes: int


class DeadlinesRequest(BaseModel):
    decision_date: date
    grievance_sent_on: date | None = None


class DeadlineStep(BaseModel):
    stage: str
    earliest: date
    latest: date
    rule_id: str
    note: str


class DeadlinesResponse(BaseModel):
    steps: list[DeadlineStep]


@router.post("/calc/proportionate", response_model=ProportionateResponse)
def calc_proportionate(body: ProportionateRequest) -> ProportionateResponse:
    result = calculators.calc_proportionate(
        body.eligible_room_rent,
        body.actual_room_rent,
        body.days,
        body.lines,
        body.exempt_categories,
        body.deduction.amount if body.deduction else None,
        body.deduction.line_ids if body.deduction else None,
    )
    return ProportionateResponse(**result)


@router.post("/calc/waiting-period", response_model=WaitingPeriodResponse)
def calc_waiting_period(body: WaitingPeriodRequest) -> WaitingPeriodResponse:
    result = calculators.calc_waiting_period(
        body.inception_date,
        body.event_date,
        body.policy_months,
        body.regulation_months,
    )
    return WaitingPeriodResponse(**result)


@router.post("/calc/tat", response_model=TatResponse)
def calc_tat(body: TatRequest) -> TatResponse:
    result = calculators.calc_tat(body.requested_at, body.decided_at, body.limit_minutes)
    return TatResponse(**result)


@router.post("/calc/deadlines", response_model=DeadlinesResponse)
def calc_deadlines(body: DeadlinesRequest) -> DeadlinesResponse:
    result = calculators.calc_deadlines(body.decision_date, body.grievance_sent_on)
    return DeadlinesResponse(**result)
