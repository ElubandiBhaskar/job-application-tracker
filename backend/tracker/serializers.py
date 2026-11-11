from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from .models import Company, Interview, JobApplication, StatusHistory


class OwnedPrimaryKeyField(serializers.PrimaryKeyRelatedField):
    """A foreign key that only accepts objects belonging to the logged in user."""

    def get_queryset(self):
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return self.queryset.none()
        return self.queryset.filter(owner=request.user)


class CompanySerializer(serializers.ModelSerializer):
    application_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Company
        fields = ("id", "name", "website", "location", "industry", "notes",
                  "application_count", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if "application_count" not in data:
            data["application_count"] = instance.applications.count()
        return data

    def validate_name(self, value):
        duplicates = Company.objects.filter(owner=self.context["request"].user, name__iexact=value)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError("You already have a company with this name.")
        return value


class StatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = StatusHistory
        fields = ("id", "from_status", "to_status", "changed_at")


class ApplicationSerializer(serializers.ModelSerializer):
    """
    Pass either `company` (id of one of your companies) or `company_name`.
    With a name, the company is looked up case-insensitively and created if it's new,
    which keeps the "add application" form to a single text box.
    """

    company = OwnedPrimaryKeyField(queryset=Company.objects.all(), required=False)
    company_name = serializers.CharField(max_length=150, required=False)
    interview_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = JobApplication
        fields = (
            "id", "company", "company_name", "job_title", "job_url", "location", "work_mode",
            "status", "source", "salary_min", "salary_max", "applied_date", "notes",
            "interview_count", "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")
        # explicit cap so every database behaves the same (Postgres integers top out at ~2.1 billion)
        extra_kwargs = {
            "salary_min": {"max_value": 2_000_000_000},
            "salary_max": {"max_value": 2_000_000_000},
        }

    # --- field level -------------------------------------------------

    def validate_applied_date(self, value):
        # +1 day of slack: someone in Asia can already be on "tomorrow" in UTC terms
        if value and value > timezone.now().date() + timedelta(days=1):
            raise serializers.ValidationError("Applied date can't be in the future.")
        return value

    # --- object level ------------------------------------------------

    def validate(self, attrs):
        user = self.context["request"].user

        name = attrs.pop("company_name", None)
        if name and "company" not in attrs:
            existing = Company.objects.filter(owner=user, name__iexact=name).first()
            # don't create the company yet - that only happens once everything else validates
            attrs["company"] = existing if existing else Company(owner=user, name=name)
        elif name and "company" in attrs:
            raise serializers.ValidationError({"company": "Send either company or company_name, not both."})

        if self.instance is None and "company" not in attrs:
            raise serializers.ValidationError({"company": "Choose a company or type a company name."})

        # compare against stored values too so a PATCH of just one salary field is still checked
        sal_min = attrs.get("salary_min", getattr(self.instance, "salary_min", None))
        sal_max = attrs.get("salary_max", getattr(self.instance, "salary_max", None))
        if sal_min is not None and sal_max is not None and sal_min > sal_max:
            raise serializers.ValidationError({"salary_max": "Maximum salary can't be lower than the minimum."})

        return attrs

    # --- writes ------------------------------------------------------

    @staticmethod
    def _save_company_if_new(attrs):
        company = attrs.get("company")
        if company is None or company.pk is not None:
            return
        try:
            with transaction.atomic():
                company.save()
        except IntegrityError:
            # two requests tried to create the same company at once; use the one that won
            attrs["company"] = Company.objects.get(owner=company.owner, name__iexact=company.name)

    @transaction.atomic
    def create(self, validated_data):
        self._save_company_if_new(validated_data)
        # moving past the wishlist means you applied; default the date so it isn't left blank
        if validated_data.get("status", JobApplication.Status.APPLIED) != JobApplication.Status.WISHLIST:
            validated_data.setdefault("applied_date", timezone.now().date())
        application = JobApplication.objects.create(owner=self.context["request"].user, **validated_data)
        StatusHistory.objects.create(application=application, from_status="", to_status=application.status)
        return application

    @transaction.atomic
    def update(self, instance, validated_data):
        self._save_company_if_new(validated_data)
        old_status = instance.status
        new_status = validated_data.get("status", old_status)
        if (old_status == JobApplication.Status.WISHLIST
                and new_status != JobApplication.Status.WISHLIST
                and not (validated_data.get("applied_date") or instance.applied_date)):
            validated_data["applied_date"] = timezone.now().date()

        instance = super().update(instance, validated_data)
        if instance.status != old_status:
            StatusHistory.objects.create(application=instance, from_status=old_status, to_status=instance.status)
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["company_name"] = instance.company.name
        if "interview_count" not in data:  # freshly created objects aren't annotated
            data["interview_count"] = instance.interviews.count()
        return data


class InterviewSerializer(serializers.ModelSerializer):
    application = OwnedPrimaryKeyField(queryset=JobApplication.objects.all())
    application_title = serializers.CharField(source="application.job_title", read_only=True)
    company_name = serializers.CharField(source="application.company.name", read_only=True)

    class Meta:
        model = Interview
        fields = ("id", "application", "application_title", "company_name", "kind", "status",
                  "scheduled_at", "location", "interviewer", "notes", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_application(self, value):
        if self.instance and value.pk != self.instance.application_id:
            raise serializers.ValidationError("An interview can't be moved to a different application.")
        return value
