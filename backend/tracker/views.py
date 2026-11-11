from datetime import date

from django.db import IntegrityError
from django.db.models import Count, ProtectedError
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework import status as http
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend

from .filters import ApplicationFilter, CompanyFilter, InterviewFilter, StableOrderingFilter
from .models import Company, Interview, JobApplication
from .serializers import (
    ApplicationSerializer,
    CompanySerializer,
    InterviewSerializer,
    StatusHistorySerializer,
)

FILTER_BACKENDS = [DjangoFilterBackend, SearchFilter, StableOrderingFilter]


class CompanyViewSet(viewsets.ModelViewSet):
    serializer_class = CompanySerializer
    filter_backends = FILTER_BACKENDS
    filterset_class = CompanyFilter
    search_fields = ["name", "location", "industry", "notes"]
    ordering_fields = ["name", "created_at", "application_count"]
    ordering = ["name"]

    def get_queryset(self):
        # every query starts from the logged in user - this is the access control
        return (
            Company.objects.filter(owner=self.request.user)
            .annotate(application_count=Count("applications"))
        )

    def perform_create(self, serializer):
        try:
            serializer.save(owner=self.request.user)
        except IntegrityError:
            # double-click / parallel request slipped past the serializer's duplicate check
            raise ValidationError({"name": ["You already have a company with this name."]})

    def destroy(self, request, *args, **kwargs):
        company = self.get_object()
        try:
            company.delete()
        except ProtectedError:
            count = company.applications.count()
            return Response(
                {"detail": f"{company.name} still has {count} application{'s' if count != 1 else ''}. "
                           "Delete or move them first."},
                status=http.HTTP_409_CONFLICT,
            )
        return Response(status=http.HTTP_204_NO_CONTENT)


class ApplicationViewSet(viewsets.ModelViewSet):
    serializer_class = ApplicationSerializer
    filter_backends = FILTER_BACKENDS
    filterset_class = ApplicationFilter
    search_fields = ["job_title", "company__name", "location", "source", "notes"]
    ordering_fields = ["updated_at", "created_at", "applied_date", "job_title", "company__name", "status"]
    ordering = ["-updated_at"]

    def get_queryset(self):
        return (
            JobApplication.objects.filter(owner=self.request.user)
            .select_related("company")
            .annotate(interview_count=Count("interviews"))
        )

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        application = self.get_object()
        return Response(StatusHistorySerializer(application.history.all(), many=True).data)


class InterviewViewSet(viewsets.ModelViewSet):
    serializer_class = InterviewSerializer
    filter_backends = FILTER_BACKENDS
    filterset_class = InterviewFilter
    search_fields = ["interviewer", "location", "notes", "application__job_title", "application__company__name"]
    ordering_fields = ["scheduled_at", "created_at"]
    ordering = ["scheduled_at"]

    def get_queryset(self):
        return Interview.objects.filter(application__owner=self.request.user).select_related(
            "application__company"
        )


class StatsView(APIView):
    """Numbers for the dashboard."""

    MONTHS_BACK = 6

    def get(self, request):
        applications = JobApplication.objects.filter(owner=request.user)

        counts = dict(applications.values_list("status").annotate(n=Count("id")))
        by_status = {value: counts.get(value, 0) for value, _ in JobApplication.Status.choices}
        total = sum(by_status.values())
        closed = sum(by_status[s] for s in JobApplication.CLOSED_STATUSES)

        upcoming = (
            Interview.objects.filter(
                application__owner=request.user,
                status=Interview.Status.SCHEDULED,
                scheduled_at__gte=timezone.now(),
            )
            .select_related("application__company")
            .order_by("scheduled_at", "id")
        )

        recent = applications.select_related("company").order_by("-created_at", "-id")[:5]

        return Response({
            "total": total,
            "active": total - closed,
            "offers": by_status["offer"] + by_status["accepted"],
            "by_status": by_status,
            "upcoming_interview_count": upcoming.count(),
            "upcoming_interviews": InterviewSerializer(upcoming[:5], many=True).data,
            "recent_applications": [
                {
                    "id": a.id,
                    "job_title": a.job_title,
                    "company_name": a.company.name,
                    "status": a.status,
                    "applied_date": a.applied_date,
                }
                for a in recent
            ],
            "monthly": self._monthly(applications),
        })

    def _monthly(self, applications):
        """Applications per month for the last few months, zero-filled."""
        today = timezone.now().date()
        months = []
        year, month = today.year, today.month
        for _ in range(self.MONTHS_BACK):
            months.append(date(year, month, 1))
            month -= 1
            if month == 0:
                year, month = year - 1, 12
        months.reverse()

        rows = (
            applications.filter(applied_date__gte=months[0])
            .annotate(month=TruncMonth("applied_date"))
            .values("month")
            .annotate(n=Count("id"))
        )
        found = {row["month"]: row["n"] for row in rows}
        return [{"month": m.strftime("%Y-%m"), "count": found.get(m, 0)} for m in months]
