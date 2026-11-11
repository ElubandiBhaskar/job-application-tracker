from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from tracker.models import Company, Interview, JobApplication, StatusHistory

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "Demo-pass-2026!"

# (company, industry, location, [(title, status, work_mode, days_ago, source)])
SAMPLE = [
    ("Zoho", "Software", "Chennai", [
        ("Python Developer", "interviewing", "hybrid", 12, "Company site"),
        ("Backend Engineer", "rejected", "onsite", 40, "LinkedIn"),
    ]),
    ("Freshworks", "SaaS", "Hyderabad", [
        ("Django Developer", "screening", "hybrid", 6, "Referral"),
    ]),
    ("Razorpay", "Fintech", "Bengaluru", [
        ("Full Stack Engineer", "applied", "remote", 3, "LinkedIn"),
        ("API Engineer", "offer", "remote", 25, "Naukri"),
    ]),
    ("Postman", "Developer tools", "Bengaluru", [
        ("Software Engineer II", "wishlist", "hybrid", None, "Career page"),
    ]),
    ("Swiggy", "Consumer tech", "Bengaluru", [
        ("Backend Developer", "withdrawn", "onsite", 33, "Recruiter"),
    ]),
]


class Command(BaseCommand):
    help = "Create a demo user with some sample applications (safe to run more than once)."

    @transaction.atomic
    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(email=DEMO_EMAIL, defaults={"first_name": "Demo"})
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save()
        elif user.applications.exists():
            self.stdout.write("Demo data already there, nothing to do.")
            return

        now = timezone.now()
        interview_plan = {"Python Developer": [("technical", 2)], "API Engineer": [("hr", -5), ("managerial", 4)]}

        for name, industry, location, jobs in SAMPLE:
            company = Company.objects.create(owner=user, name=name, industry=industry, location=location)
            for title, status, mode, days_ago, source in jobs:
                applied = (now - timedelta(days=days_ago)).date() if days_ago is not None else None
                app = JobApplication.objects.create(
                    owner=user, company=company, job_title=title, status=status, work_mode=mode,
                    location=location, source=source, applied_date=applied,
                )
                StatusHistory.objects.create(application=app, from_status="", to_status=status)
                for kind, offset in interview_plan.get(title, []):
                    Interview.objects.create(
                        application=app, kind=kind, scheduled_at=now + timedelta(days=offset),
                        status="scheduled" if offset > 0 else "completed", interviewer="Hiring team",
                    )

        self.stdout.write(self.style.SUCCESS(f"Demo user ready: {DEMO_EMAIL} / {DEMO_PASSWORD}"))
