import django_filters
from django.db.models import F
from django.utils import timezone
from rest_framework.filters import OrderingFilter

from .models import Company, Interview, JobApplication


class StableOrderingFilter(OrderingFilter):
    """
    OrderingFilter with two fixes that matter once you paginate:

    * nulls always sort last (Postgres puts NULLs first on DESC, so an application
      without an applied date would jump to the top of "newest first")
    * `id` is added as a tie-breaker, otherwise rows with equal sort values can
      show up on two pages or none at all.
    """

    def filter_queryset(self, request, queryset, view):
        ordering = self.get_ordering(request, queryset, view)
        if not ordering:
            return queryset

        terms = []
        for field in ordering:
            if field.lstrip("-") == "id":
                continue
            expr = F(field.lstrip("-"))
            terms.append(expr.desc(nulls_last=True) if field.startswith("-") else expr.asc(nulls_last=True))
        terms.append(F("id").desc() if ordering[0].startswith("-") else F("id").asc())
        return queryset.order_by(*terms)


class ApplicationFilter(django_filters.FilterSet):
    # ?status=applied&status=offer  (single value works too)
    status = django_filters.MultipleChoiceFilter(choices=JobApplication.Status.choices)
    work_mode = django_filters.ChoiceFilter(choices=JobApplication.WorkMode.choices)
    company = django_filters.NumberFilter(field_name="company_id")
    source = django_filters.CharFilter(field_name="source", lookup_expr="iexact")
    applied_after = django_filters.DateFilter(field_name="applied_date", lookup_expr="gte")
    applied_before = django_filters.DateFilter(field_name="applied_date", lookup_expr="lte")
    # open = still in play, i.e. not accepted/rejected/withdrawn
    active = django_filters.BooleanFilter(method="filter_active")

    class Meta:
        model = JobApplication
        fields = ["status", "work_mode", "company", "source", "applied_after", "applied_before", "active"]

    def filter_active(self, queryset, name, value):
        if value is None:
            return queryset
        closed = JobApplication.CLOSED_STATUSES
        return queryset.exclude(status__in=closed) if value else queryset.filter(status__in=closed)


class InterviewFilter(django_filters.FilterSet):
    application = django_filters.NumberFilter(field_name="application_id")
    status = django_filters.ChoiceFilter(choices=Interview.Status.choices)
    kind = django_filters.ChoiceFilter(choices=Interview.Kind.choices)
    # upcoming=true -> still scheduled and in the future
    upcoming = django_filters.BooleanFilter(method="filter_upcoming")

    class Meta:
        model = Interview
        fields = ["application", "status", "kind", "upcoming"]

    def filter_upcoming(self, queryset, name, value):
        if value is None:
            return queryset
        upcoming = queryset.filter(status=Interview.Status.SCHEDULED, scheduled_at__gte=timezone.now())
        return upcoming if value else queryset.exclude(pk__in=upcoming.values("pk"))


class CompanyFilter(django_filters.FilterSet):
    class Meta:
        model = Company
        fields = ["industry"]
