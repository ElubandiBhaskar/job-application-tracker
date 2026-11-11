from datetime import date, timedelta

from django.utils import timezone

from tracker.models import JobApplication
from .base import ApiTestCase

S = JobApplication.Status


class StatsTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.url_ = self.url("stats")

    def test_empty_account(self):
        res = self.alice_client.get(self.url_)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total"], 0)
        self.assertEqual(res.data["active"], 0)
        self.assertEqual(res.data["upcoming_interviews"], [])
        self.assertEqual(len(res.data["monthly"]), 6)
        self.assertTrue(all(m["count"] == 0 for m in res.data["monthly"]))
        # every status is present even when zero, so the UI never has to guess
        self.assertEqual(set(res.data["by_status"]), {value for value, _ in S.choices})

    def test_counts(self):
        for status in (S.APPLIED, S.APPLIED, S.INTERVIEWING, S.OFFER, S.ACCEPTED, S.REJECTED, S.WITHDRAWN, S.WISHLIST):
            self.make_application(status=status)
        res = self.alice_client.get(self.url_)
        self.assertEqual(res.data["total"], 8)
        self.assertEqual(res.data["by_status"]["applied"], 2)
        self.assertEqual(res.data["by_status"]["interviewing"], 1)
        self.assertEqual(res.data["active"], 5)    # everything except accepted / rejected / withdrawn
        self.assertEqual(res.data["offers"], 2)    # offer + accepted

    def test_other_users_data_is_excluded(self):
        self.make_application(owner=self.alice, status=S.APPLIED)
        for _ in range(3):
            self.make_application(owner=self.bob, status=S.APPLIED)
        res = self.alice_client.get(self.url_)
        self.assertEqual(res.data["total"], 1)
        self.assertEqual(len(res.data["recent_applications"]), 1)

    def test_upcoming_interviews_only_future_scheduled_and_own(self):
        now = timezone.now()
        app = self.make_application(title="Dev", company_name="Acme")
        soon = self.make_interview(app, now + timedelta(days=1))
        self.make_interview(app, now - timedelta(days=1))
        self.make_interview(app, now + timedelta(days=3), status="cancelled")
        self.make_interview(app, now + timedelta(days=4), status="completed")
        bobs = self.make_application(owner=self.bob, title="Bob job")
        self.make_interview(bobs, now + timedelta(days=1))

        res = self.alice_client.get(self.url_)
        self.assertEqual(res.data["upcoming_interview_count"], 1)
        self.assertEqual([i["id"] for i in res.data["upcoming_interviews"]], [soon.pk])
        self.assertEqual(res.data["upcoming_interviews"][0]["company_name"], "Acme")

    def test_upcoming_list_is_capped_but_count_is_not(self):
        app = self.make_application()
        for i in range(8):
            self.make_interview(app, timezone.now() + timedelta(days=i + 1))
        res = self.alice_client.get(self.url_)
        self.assertEqual(res.data["upcoming_interview_count"], 8)
        self.assertEqual(len(res.data["upcoming_interviews"]), 5)

    def test_recent_applications_newest_first_max_five(self):
        for i in range(7):
            self.make_application(title=f"Job {i}")
        res = self.alice_client.get(self.url_)
        titles = [a["job_title"] for a in res.data["recent_applications"]]
        self.assertEqual(titles, ["Job 6", "Job 5", "Job 4", "Job 3", "Job 2"])

    def test_monthly_series_is_zero_filled_and_ends_this_month(self):
        today = timezone.now().date()
        self.make_application(title="a", applied_date=today)
        self.make_application(title="b", applied_date=today)
        self.make_application(title="c", applied_date=date(2000, 1, 1))  # too old to show
        self.make_application(title="d", status=S.WISHLIST)               # no date at all
        res = self.alice_client.get(self.url_)
        months = res.data["monthly"]
        self.assertEqual(len(months), 6)
        self.assertEqual(months[-1], {"month": today.strftime("%Y-%m"), "count": 2})
        self.assertEqual(sum(m["count"] for m in months), 2)
        keys = [m["month"] for m in months]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(set(keys)), 6)
