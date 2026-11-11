from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from tracker.models import Company, Interview, JobApplication, StatusHistory

PASSWORD = "Sup3r-secret-pw"


class ApiTestCase(APITestCase):
    """Shared helpers: two users, an authenticated client for each, and quick factories."""

    def setUp(self):
        cache.clear()  # throttle counters live in the cache
        self.alice = User.objects.create_user(email="alice@example.com", password=PASSWORD, first_name="Alice")
        self.bob = User.objects.create_user(email="bob@example.com", password=PASSWORD, first_name="Bob")
        self.alice_client = self.client_for(self.alice)
        self.bob_client = self.client_for(self.bob)

    @staticmethod
    def client_for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # factories -----------------------------------------------------

    def make_company(self, owner=None, name="Acme Corp", **extra):
        return Company.objects.create(owner=owner or self.alice, name=name, **extra)

    def make_application(self, owner=None, company=None, title="Backend Developer", **extra):
        owner = owner or self.alice
        company = company or self.make_company(owner=owner, name=extra.pop("company_name", f"Co {JobApplication.objects.count()}"))
        status = extra.get("status", JobApplication.Status.APPLIED)
        app = JobApplication.objects.create(owner=owner, company=company, job_title=title, **extra)
        StatusHistory.objects.create(application=app, from_status="", to_status=status)
        return app

    def make_interview(self, application, when, **extra):
        return Interview.objects.create(application=application, scheduled_at=when, **extra)

    # url helpers ---------------------------------------------------

    @staticmethod
    def url(name, *args):
        return reverse(name, args=args)
