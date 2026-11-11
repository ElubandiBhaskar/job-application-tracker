from django.conf import settings
from django.db import models
from django.db.models.functions import Lower


class Company(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="companies")
    name = models.CharField(max_length=150)
    website = models.URLField(blank=True)
    location = models.CharField(max_length=150, blank=True)
    industry = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "companies"
        ordering = ["name", "id"]
        constraints = [
            # "Google" and "google" are the same company for one user
            models.UniqueConstraint(Lower("name"), "owner", name="uniq_company_name_per_owner"),
        ]

    def __str__(self):
        return self.name


class JobApplication(models.Model):
    class Status(models.TextChoices):
        WISHLIST = "wishlist", "Wishlist"
        APPLIED = "applied", "Applied"
        SCREENING = "screening", "Screening"
        INTERVIEWING = "interviewing", "Interviewing"
        OFFER = "offer", "Offer"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        WITHDRAWN = "withdrawn", "Withdrawn"

    class WorkMode(models.TextChoices):
        ONSITE = "onsite", "On-site"
        HYBRID = "hybrid", "Hybrid"
        REMOTE = "remote", "Remote"

    # statuses where nothing more is going to happen
    CLOSED_STATUSES = (Status.ACCEPTED, Status.REJECTED, Status.WITHDRAWN)

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="applications")
    # PROTECT: deleting a company shouldn't silently wipe out the applications under it
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="applications")
    job_title = models.CharField(max_length=200)
    job_url = models.URLField(max_length=500, blank=True)
    location = models.CharField(max_length=150, blank=True)
    work_mode = models.CharField(max_length=10, choices=WorkMode.choices, default=WorkMode.ONSITE)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.APPLIED, db_index=True)
    source = models.CharField(max_length=100, blank=True, help_text="Where you found it: LinkedIn, referral, ...")
    salary_min = models.PositiveIntegerField(null=True, blank=True)
    salary_max = models.PositiveIntegerField(null=True, blank=True)
    applied_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [
            models.Index(fields=["owner", "status"]),
            models.Index(fields=["owner", "-applied_date"]),
        ]

    def __str__(self):
        return f"{self.job_title} @ {self.company.name}"


class StatusHistory(models.Model):
    """One row per status change, so the detail page can show a timeline."""

    application = models.ForeignKey(JobApplication, on_delete=models.CASCADE, related_name="history")
    from_status = models.CharField(max_length=15, blank=True)  # empty = the application was just created
    to_status = models.CharField(max_length=15)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "status history"
        ordering = ["changed_at", "id"]

    def __str__(self):
        return f"{self.application_id}: {self.from_status or '-'} -> {self.to_status}"


class Interview(models.Model):
    class Kind(models.TextChoices):
        PHONE = "phone", "Phone screen"
        TECHNICAL = "technical", "Technical"
        HR = "hr", "HR"
        MANAGERIAL = "managerial", "Managerial"
        ONSITE = "onsite", "On-site"
        ASSIGNMENT = "assignment", "Take-home assignment"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    application = models.ForeignKey(JobApplication, on_delete=models.CASCADE, related_name="interviews")
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.TECHNICAL)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.SCHEDULED)
    scheduled_at = models.DateTimeField()
    location = models.CharField(max_length=200, blank=True, help_text="Address or meeting link")
    interviewer = models.CharField(max_length=150, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_at", "id"]
        indexes = [models.Index(fields=["application", "scheduled_at"])]

    def __str__(self):
        return f"{self.get_kind_display()} for application {self.application_id}"
