from datetime import date, timedelta
from unittest import mock

from django.utils import timezone

from tracker.models import Company, Interview, JobApplication, StatusHistory
from tracker.serializers import ApplicationSerializer
from .base import ApiTestCase

S = JobApplication.Status


class ApplicationCreateTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.list_url = self.url("application-list")

    def post(self, client=None, **overrides):
        payload = {"job_title": "Python Developer", "company_name": "Acme Corp"}
        payload.update(overrides)
        return (client or self.alice_client).post(self.list_url, payload, format="json")

    def test_requires_login(self):
        res = self.client_class().post(self.list_url, {"job_title": "x"}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_create_with_new_company_name_creates_the_company(self):
        res = self.post()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["company_name"], "Acme Corp")
        self.assertEqual(res.data["status"], "applied")
        self.assertEqual(res.data["interview_count"], 0)
        company = Company.objects.get(owner=self.alice, name="Acme Corp")
        self.assertEqual(res.data["company"], company.pk)
        self.assertEqual(JobApplication.objects.get(pk=res.data["id"]).owner, self.alice)

    def test_company_name_reuses_existing_company_ignoring_case(self):
        existing = self.make_company(name="Acme Corp")
        res = self.post(company_name="  acme corp ")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["company"], existing.pk)
        self.assertEqual(Company.objects.filter(owner=self.alice).count(), 1)

    def test_create_with_company_id(self):
        company = self.make_company(name="Globex")
        res = self.alice_client.post(
            self.list_url, {"job_title": "SRE", "company": company.pk}, format="json"
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["company_name"], "Globex")

    def test_same_company_name_for_two_users_makes_two_companies(self):
        self.post(client=self.alice_client)
        self.post(client=self.bob_client)
        self.assertEqual(Company.objects.filter(name="Acme Corp").count(), 2)

    def test_cannot_attach_application_to_another_users_company(self):
        theirs = self.make_company(owner=self.bob, name="Bobs Inc")
        res = self.alice_client.post(self.list_url, {"job_title": "x", "company": theirs.pk}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("company", res.data)
        self.assertEqual(JobApplication.objects.count(), 0)

    def test_company_required(self):
        res = self.alice_client.post(self.list_url, {"job_title": "x"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("company", res.data)

    def test_company_and_company_name_together_rejected(self):
        company = self.make_company()
        res = self.post(company=company.pk)
        self.assertEqual(res.status_code, 400)

    def test_failed_validation_does_not_leave_a_stray_company_behind(self):
        res = self.post(company_name="Ghost Ltd", status="nonsense")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Company.objects.filter(name="Ghost Ltd").exists())

    def test_job_title_required_and_not_blank(self):
        self.assertEqual(self.post(job_title="   ").status_code, 400)
        res = self.alice_client.post(self.list_url, {"company_name": "X"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("job_title", res.data)

    def test_invalid_choices(self):
        self.assertEqual(self.post(status="hired!").status_code, 400)
        self.assertEqual(self.post(work_mode="underwater").status_code, 400)

    def test_owner_in_payload_is_ignored(self):
        res = self.post(owner=self.bob.pk)
        self.assertEqual(JobApplication.objects.get(pk=res.data["id"]).owner, self.alice)

    def test_status_history_starts_with_creation_entry(self):
        res = self.post(status="screening")
        rows = list(StatusHistory.objects.filter(application_id=res.data["id"]))
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0].from_status, rows[0].to_status), ("", "screening"))

    def test_applied_date_defaults_to_today_unless_wishlist(self):
        applied = self.post()
        self.assertEqual(applied.data["applied_date"], timezone.now().date().isoformat())
        wishlist = self.post(job_title="Dream job", status="wishlist")
        self.assertIsNone(wishlist.data["applied_date"])

    def test_explicit_applied_date_is_kept(self):
        res = self.post(applied_date="2026-01-15")
        self.assertEqual(res.data["applied_date"], "2026-01-15")

    def test_future_applied_date_rejected_but_tomorrow_allowed(self):
        far = (timezone.now().date() + timedelta(days=10)).isoformat()
        soon = (timezone.now().date() + timedelta(days=1)).isoformat()
        self.assertEqual(self.post(applied_date=far).status_code, 400)
        self.assertEqual(self.post(applied_date=soon).status_code, 201)

    def test_bad_date_format(self):
        self.assertEqual(self.post(applied_date="15/01/2026").status_code, 400)

    def test_salary_range_validation(self):
        self.assertEqual(self.post(salary_min=100000, salary_max=50000).status_code, 400)
        self.assertEqual(self.post(salary_min=-5).status_code, 400)
        self.assertEqual(self.post(salary_max=99999999999).status_code, 400)  # would overflow the DB column
        ok = self.post(salary_min=50000, salary_max=50000)
        self.assertEqual(ok.status_code, 201)

    def test_bad_job_url(self):
        self.assertEqual(self.post(job_url="not a url").status_code, 400)
        self.assertEqual(self.post(job_url="https://jobs.example.com/123").status_code, 201)

    def test_race_on_company_creation_falls_back_to_the_existing_one(self):
        existing = self.make_company(name="Acme Corp")
        loser = Company(owner=self.alice, name="acme corp")  # what the serializer builds before saving
        attrs = {"company": loser}
        ApplicationSerializer._save_company_if_new(attrs)
        self.assertEqual(attrs["company"].pk, existing.pk)


class ApplicationUpdateTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.app = self.make_application(title="Dev", status=S.APPLIED, applied_date=date(2026, 3, 1))
        self.detail = self.url("application-detail", self.app.pk)

    def test_change_status_records_history(self):
        res = self.alice_client.patch(self.detail, {"status": "interviewing"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "interviewing")
        hist = list(self.app.history.values_list("from_status", "to_status"))
        self.assertEqual(hist, [("", "applied"), ("applied", "interviewing")])

    def test_editing_other_fields_does_not_add_history(self):
        self.alice_client.patch(self.detail, {"notes": "Spoke to recruiter"}, format="json")
        self.alice_client.patch(self.detail, {"status": "applied"}, format="json")  # same status
        self.assertEqual(self.app.history.count(), 1)

    def test_full_put_works(self):
        payload = {"job_title": "Senior Dev", "company": self.app.company_id, "status": "offer",
                   "work_mode": "remote", "salary_min": 10, "salary_max": 20}
        res = self.alice_client.put(self.detail, payload, format="json")
        self.assertEqual(res.status_code, 200)
        self.app.refresh_from_db()
        self.assertEqual((self.app.job_title, self.app.status, self.app.work_mode), ("Senior Dev", "offer", "remote"))

    def test_can_move_to_a_new_company_by_name(self):
        res = self.alice_client.patch(self.detail, {"company_name": "Brand New Co"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["company_name"], "Brand New Co")

    def test_patching_only_salary_max_is_checked_against_stored_min(self):
        JobApplication.objects.filter(pk=self.app.pk).update(salary_min=80000)
        res = self.alice_client.patch(self.detail, {"salary_max": 1000}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_wishlist_to_applied_sets_applied_date(self):
        wish = self.make_application(title="Dream", status=S.WISHLIST)
        res = self.alice_client.patch(self.url("application-detail", wish.pk), {"status": "applied"}, format="json")
        self.assertEqual(res.data["applied_date"], timezone.now().date().isoformat())

    def test_wishlist_to_applied_keeps_an_existing_date(self):
        wish = self.make_application(title="Dream", status=S.WISHLIST, applied_date=date(2026, 2, 2))
        res = self.alice_client.patch(self.url("application-detail", wish.pk), {"status": "applied"}, format="json")
        self.assertEqual(res.data["applied_date"], "2026-02-02")

    def test_can_clear_applied_date_and_salary(self):
        JobApplication.objects.filter(pk=self.app.pk).update(salary_min=1, salary_max=2)
        res = self.alice_client.patch(
            self.detail, {"applied_date": None, "salary_min": None, "salary_max": None}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["applied_date"])

    def test_cannot_reassign_owner(self):
        self.alice_client.patch(self.detail, {"owner": self.bob.pk}, format="json")
        self.app.refresh_from_db()
        self.assertEqual(self.app.owner, self.alice)

    def test_delete_removes_history_and_interviews_too(self):
        self.make_interview(self.app, timezone.now() + timedelta(days=1))
        res = self.alice_client.delete(self.detail)
        self.assertEqual(res.status_code, 204)
        self.assertEqual(JobApplication.objects.count(), 0)
        self.assertEqual(StatusHistory.objects.count(), 0)
        self.assertEqual(Interview.objects.count(), 0)
        self.assertTrue(Company.objects.filter(pk=self.app.company_id).exists())  # company stays

    def test_update_failure_rolls_back_status_history(self):
        broken = mock.patch("tracker.serializers.StatusHistory.objects.create", side_effect=RuntimeError("boom"))
        with broken, self.assertLogs("django.request", level="ERROR"), self.assertRaises(RuntimeError):
            self.alice_client.patch(self.detail, {"status": "offer"}, format="json")
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "applied")


class ApplicationAccessControlTests(ApiTestCase):
    """Alice must never see or touch Bob's data."""

    def setUp(self):
        super().setUp()
        self.mine = self.make_application(owner=self.alice, title="Mine")
        self.theirs = self.make_application(owner=self.bob, title="Theirs")
        self.theirs_url = self.url("application-detail", self.theirs.pk)

    def test_list_contains_only_my_applications(self):
        res = self.alice_client.get(self.url("application-list"))
        self.assertEqual([a["job_title"] for a in res.data["results"]], ["Mine"])

    def test_cannot_read_update_or_delete_someone_elses(self):
        self.assertEqual(self.alice_client.get(self.theirs_url).status_code, 404)
        self.assertEqual(self.alice_client.patch(self.theirs_url, {"job_title": "Pwned"}, format="json").status_code, 404)
        self.assertEqual(self.alice_client.put(self.theirs_url, {"job_title": "Pwned"}, format="json").status_code, 404)
        self.assertEqual(self.alice_client.delete(self.theirs_url).status_code, 404)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.job_title, "Theirs")

    def test_cannot_read_someone_elses_history(self):
        res = self.alice_client.get(self.url("application-history", self.theirs.pk))
        self.assertEqual(res.status_code, 404)

    def test_filters_cannot_be_used_to_peek_at_other_users_data(self):
        res = self.alice_client.get(self.url("application-list"), {"company": self.theirs.company_id})
        self.assertEqual(res.data["count"], 0)
        res = self.alice_client.get(self.url("application-list"), {"search": "Theirs"})
        self.assertEqual(res.data["count"], 0)

    def test_anonymous_gets_401_everywhere(self):
        anon = self.client_class()
        self.assertEqual(anon.get(self.url("application-list")).status_code, 401)
        self.assertEqual(anon.get(self.url("application-detail", self.mine.pk)).status_code, 401)
        self.assertEqual(anon.get(self.url("application-history", self.mine.pk)).status_code, 401)
        self.assertEqual(anon.get(self.url("stats")).status_code, 401)

    def test_non_numeric_id_is_a_clean_404(self):
        self.assertEqual(self.alice_client.get("/api/applications/abc/").status_code, 404)

    def test_missing_id_is_404(self):
        self.assertEqual(self.alice_client.get(self.url("application-detail", 999999)).status_code, 404)


class ApplicationListTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.list_url = self.url("application-list")
        google = self.make_company(name="Google", location="Hyderabad")
        zoho = self.make_company(name="Zoho")
        self.a1 = self.make_application(company=google, title="Python Developer", status=S.APPLIED,
                                        work_mode="remote", applied_date=date(2026, 1, 10), source="LinkedIn")
        self.a2 = self.make_application(company=google, title="Data Engineer", status=S.INTERVIEWING,
                                        work_mode="hybrid", applied_date=date(2026, 2, 20), notes="Referred by Sam")
        self.a3 = self.make_application(company=zoho, title="Backend Engineer", status=S.REJECTED,
                                        work_mode="onsite", applied_date=date(2026, 3, 5))
        self.a4 = self.make_application(company=zoho, title="Wishlist Role", status=S.WISHLIST,
                                        applied_date=None)

    def titles(self, **params):
        res = self.alice_client.get(self.list_url, params)
        self.assertEqual(res.status_code, 200, res.data)
        return [a["job_title"] for a in res.data["results"]]

    def test_list_shape_and_counts(self):
        self.make_interview(self.a2, timezone.now())
        res = self.alice_client.get(self.list_url)
        self.assertEqual(res.data["count"], 4)
        first = next(a for a in res.data["results"] if a["id"] == self.a2.pk)
        self.assertEqual(first["interview_count"], 1)
        self.assertEqual(first["company_name"], "Google")

    def test_search_matches_title_company_location_source_and_notes(self):
        self.assertEqual(self.titles(search="python"), ["Python Developer"])
        self.assertCountEqual(self.titles(search="google"), ["Python Developer", "Data Engineer"])
        self.assertCountEqual(self.titles(search="zoho"), ["Backend Engineer", "Wishlist Role"])
        self.assertEqual(self.titles(search="linkedin"), ["Python Developer"])
        self.assertEqual(self.titles(search="referred"), ["Data Engineer"])
        self.assertEqual(self.titles(search="no-such-thing"), [])

    def test_search_is_case_insensitive_and_handles_odd_characters(self):
        self.assertEqual(self.titles(search="PYTHON"), ["Python Developer"])
        self.assertEqual(self.titles(search="100%"), [])
        self.assertEqual(self.titles(search="'; drop table"), [])

    def test_filter_by_status(self):
        self.assertEqual(self.titles(status="interviewing"), ["Data Engineer"])

    def test_filter_by_several_statuses(self):
        res = self.alice_client.get(self.list_url + "?status=applied&status=rejected")
        self.assertCountEqual([a["job_title"] for a in res.data["results"]], ["Python Developer", "Backend Engineer"])

    def test_invalid_status_filter_is_a_400_not_empty_or_500(self):
        res = self.alice_client.get(self.list_url, {"status": "bogus"})
        self.assertEqual(res.status_code, 400)

    def test_filter_by_work_mode_company_and_source(self):
        self.assertEqual(self.titles(work_mode="remote"), ["Python Developer"])
        self.assertCountEqual(self.titles(company=self.a3.company_id), ["Backend Engineer", "Wishlist Role"])
        self.assertEqual(self.titles(source="linkedin"), ["Python Developer"])

    def test_filter_by_applied_date_range(self):
        self.assertCountEqual(self.titles(applied_after="2026-02-01"), ["Data Engineer", "Backend Engineer"])
        self.assertCountEqual(self.titles(applied_before="2026-02-20"), ["Python Developer", "Data Engineer"])
        self.assertEqual(self.titles(applied_after="2026-02-01", applied_before="2026-02-28"), ["Data Engineer"])

    def test_filter_active(self):
        self.assertCountEqual(self.titles(active="true"), ["Python Developer", "Data Engineer", "Wishlist Role"])
        self.assertEqual(self.titles(active="false"), ["Backend Engineer"])

    def test_filters_combine(self):
        self.assertEqual(self.titles(search="google", status="applied"), ["Python Developer"])
        self.assertEqual(self.titles(search="zoho", status="applied"), [])

    def test_ordering_by_applied_date(self):
        self.assertEqual(self.titles(ordering="applied_date")[:3],
                         ["Python Developer", "Data Engineer", "Backend Engineer"])
        self.assertEqual(self.titles(ordering="-applied_date")[:3],
                         ["Backend Engineer", "Data Engineer", "Python Developer"])

    def test_missing_dates_always_sort_last(self):
        self.assertEqual(self.titles(ordering="applied_date")[-1], "Wishlist Role")
        self.assertEqual(self.titles(ordering="-applied_date")[-1], "Wishlist Role")

    def test_ordering_by_company_name_and_title(self):
        self.assertEqual(self.titles(ordering="job_title")[0], "Backend Engineer")
        self.assertCountEqual(self.titles(ordering="company__name")[:2], ["Python Developer", "Data Engineer"])

    def test_unknown_ordering_field_is_ignored(self):
        self.assertEqual(len(self.titles(ordering="password")), 4)

    def test_default_order_is_most_recently_updated_first(self):
        JobApplication.objects.filter(pk=self.a1.pk).update(updated_at=timezone.now() + timedelta(hours=1))
        self.assertEqual(self.titles()[0], "Python Developer")

    def test_pagination(self):
        res = self.alice_client.get(self.list_url, {"page_size": 3})
        self.assertEqual(len(res.data["results"]), 3)
        self.assertEqual(res.data["count"], 4)
        self.assertIsNotNone(res.data["next"])
        res2 = self.alice_client.get(self.list_url, {"page_size": 3, "page": 2})
        self.assertEqual(len(res2.data["results"]), 1)
        self.assertIsNone(res2.data["next"])

    def test_page_out_of_range_is_404(self):
        self.assertEqual(self.alice_client.get(self.list_url, {"page": 99}).status_code, 404)

    def test_page_size_is_capped(self):
        res = self.alice_client.get(self.list_url, {"page_size": 100000})
        self.assertEqual(res.status_code, 200)

    def test_history_endpoint(self):
        self.alice_client.patch(self.url("application-detail", self.a1.pk), {"status": "offer"}, format="json")
        res = self.alice_client.get(self.url("application-history", self.a1.pk))
        self.assertEqual(res.status_code, 200)
        self.assertEqual([(h["from_status"], h["to_status"]) for h in res.data], [("", "applied"), ("applied", "offer")])


class StablePaginationTests(ApiTestCase):
    def test_paging_through_rows_with_identical_sort_values_never_duplicates_or_drops(self):
        company = self.make_company(name="Same Co")
        same_day = date(2026, 4, 1)
        ids = {self.make_application(company=company, title=f"Role {i}", applied_date=same_day).pk
               for i in range(25)}
        seen = []
        for page in (1, 2, 3):
            res = self.alice_client.get(
                self.url("application-list"), {"ordering": "-applied_date", "page_size": 10, "page": page}
            )
            self.assertEqual(res.status_code, 200)
            seen += [a["id"] for a in res.data["results"]]
        self.assertEqual(len(seen), 25)
        self.assertEqual(set(seen), ids)
