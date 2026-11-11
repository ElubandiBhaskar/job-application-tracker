from datetime import timedelta

from django.utils import timezone

from tracker.models import Interview
from .base import ApiTestCase


class InterviewApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.list_url = self.url("interview-list")
        self.app = self.make_application(title="Python Developer", company_name="Acme")
        self.now = timezone.now()

    def payload(self, **overrides):
        data = {
            "application": self.app.pk,
            "kind": "technical",
            "scheduled_at": (self.now + timedelta(days=2)).isoformat(),
            "interviewer": "Priya",
            "location": "https://meet.example.com/abc",
        }
        data.update(overrides)
        return data

    def test_requires_login(self):
        self.assertEqual(self.client_class().get(self.list_url).status_code, 401)
        self.assertEqual(self.client_class().post(self.list_url, self.payload(), format="json").status_code, 401)

    def test_create(self):
        res = self.alice_client.post(self.list_url, self.payload(), format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["status"], "scheduled")
        self.assertEqual(res.data["application_title"], "Python Developer")
        self.assertEqual(res.data["company_name"], "Acme")
        self.assertEqual(Interview.objects.count(), 1)

    def test_cannot_create_for_someone_elses_application(self):
        theirs = self.make_application(owner=self.bob, title="Theirs")
        res = self.alice_client.post(self.list_url, self.payload(application=theirs.pk), format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("application", res.data)
        self.assertEqual(Interview.objects.count(), 0)

    def test_required_fields(self):
        res = self.alice_client.post(self.list_url, {}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("application", res.data)
        self.assertIn("scheduled_at", res.data)

    def test_bad_values(self):
        self.assertEqual(self.alice_client.post(self.list_url, self.payload(scheduled_at="tomorrow"), format="json").status_code, 400)
        self.assertEqual(self.alice_client.post(self.list_url, self.payload(kind="karaoke"), format="json").status_code, 400)
        self.assertEqual(self.alice_client.post(self.list_url, self.payload(status="maybe"), format="json").status_code, 400)

    def test_update_status_and_notes(self):
        interview = self.make_interview(self.app, self.now - timedelta(hours=1))
        res = self.alice_client.patch(
            self.url("interview-detail", interview.pk),
            {"status": "completed", "notes": "Went well, asked about system design"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        interview.refresh_from_db()
        self.assertEqual(interview.status, "completed")

    def test_cannot_move_interview_to_another_application(self):
        other_app = self.make_application(title="Other", company_name="Other Co")
        interview = self.make_interview(self.app, self.now)
        res = self.alice_client.patch(
            self.url("interview-detail", interview.pk), {"application": other_app.pk}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_resending_the_same_application_on_update_is_fine(self):
        interview = self.make_interview(self.app, self.now)
        res = self.alice_client.patch(
            self.url("interview-detail", interview.pk), {"application": self.app.pk, "notes": "x"}, format="json"
        )
        self.assertEqual(res.status_code, 200)

    def test_delete(self):
        interview = self.make_interview(self.app, self.now)
        self.assertEqual(self.alice_client.delete(self.url("interview-detail", interview.pk)).status_code, 204)
        self.assertEqual(Interview.objects.count(), 0)

    def test_other_users_interviews_are_invisible_and_untouchable(self):
        theirs_app = self.make_application(owner=self.bob, title="Theirs")
        theirs = self.make_interview(theirs_app, self.now)
        detail = self.url("interview-detail", theirs.pk)
        self.assertEqual(self.alice_client.get(self.list_url).data["count"], 0)
        self.assertEqual(self.alice_client.get(detail).status_code, 404)
        self.assertEqual(self.alice_client.patch(detail, {"notes": "hi"}, format="json").status_code, 404)
        self.assertEqual(self.alice_client.delete(detail).status_code, 404)
        self.assertEqual(Interview.objects.count(), 1)

    def test_filter_by_application(self):
        other_app = self.make_application(title="Other", company_name="Other Co")
        mine = self.make_interview(self.app, self.now)
        self.make_interview(other_app, self.now)
        res = self.alice_client.get(self.list_url, {"application": self.app.pk})
        self.assertEqual([i["id"] for i in res.data["results"]], [mine.pk])

    def test_filter_application_of_another_user_returns_nothing(self):
        theirs_app = self.make_application(owner=self.bob, title="Theirs")
        self.make_interview(theirs_app, self.now)
        res = self.alice_client.get(self.list_url, {"application": theirs_app.pk})
        self.assertEqual(res.data["count"], 0)

    def test_filter_upcoming(self):
        future = self.make_interview(self.app, self.now + timedelta(days=1))
        self.make_interview(self.app, self.now - timedelta(days=1))                       # past
        self.make_interview(self.app, self.now + timedelta(days=2), status="cancelled")   # future but cancelled
        res = self.alice_client.get(self.list_url, {"upcoming": "true"})
        self.assertEqual([i["id"] for i in res.data["results"]], [future.pk])
        res = self.alice_client.get(self.list_url, {"upcoming": "false"})
        self.assertEqual(res.data["count"], 2)

    def test_filter_by_status(self):
        self.make_interview(self.app, self.now, status="completed")
        self.make_interview(self.app, self.now)
        res = self.alice_client.get(self.list_url, {"status": "completed"})
        self.assertEqual(res.data["count"], 1)

    def test_ordered_by_date_by_default_and_reversible(self):
        later = self.make_interview(self.app, self.now + timedelta(days=5))
        sooner = self.make_interview(self.app, self.now + timedelta(days=1))
        asc = self.alice_client.get(self.list_url).data["results"]
        self.assertEqual([i["id"] for i in asc], [sooner.pk, later.pk])
        desc = self.alice_client.get(self.list_url, {"ordering": "-scheduled_at"}).data["results"]
        self.assertEqual([i["id"] for i in desc], [later.pk, sooner.pk])

    def test_application_list_reports_interview_count(self):
        self.make_interview(self.app, self.now)
        self.make_interview(self.app, self.now)
        res = self.alice_client.get(self.url("application-detail", self.app.pk))
        self.assertEqual(res.data["interview_count"], 2)
