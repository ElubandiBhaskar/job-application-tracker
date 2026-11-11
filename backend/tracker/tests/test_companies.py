from unittest import mock

from django.db import IntegrityError, transaction

from tracker.models import Company
from tracker.serializers import CompanySerializer
from .base import ApiTestCase


class CompanyApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.list_url = self.url("company-list")

    def test_every_endpoint_needs_login(self):
        company = self.make_company()
        anon = self.client_class()
        self.assertEqual(anon.get(self.list_url).status_code, 401)
        self.assertEqual(anon.post(self.list_url, {"name": "X"}, format="json").status_code, 401)
        self.assertEqual(anon.get(self.url("company-detail", company.pk)).status_code, 401)
        self.assertEqual(anon.delete(self.url("company-detail", company.pk)).status_code, 401)

    def test_create(self):
        res = self.alice_client.post(
            self.list_url,
            {"name": "  Globex  ", "website": "https://globex.example", "industry": "Energy"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["name"], "Globex")
        self.assertEqual(res.data["application_count"], 0)
        self.assertEqual(Company.objects.get(pk=res.data["id"]).owner, self.alice)

    def test_owner_in_payload_is_ignored(self):
        res = self.alice_client.post(self.list_url, {"name": "Sneaky", "owner": self.bob.pk}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Company.objects.get(pk=res.data["id"]).owner, self.alice)

    def test_name_required_and_not_blank(self):
        self.assertEqual(self.alice_client.post(self.list_url, {}, format="json").status_code, 400)
        self.assertEqual(self.alice_client.post(self.list_url, {"name": "   "}, format="json").status_code, 400)

    def test_bad_website(self):
        res = self.alice_client.post(self.list_url, {"name": "X", "website": "nope"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("website", res.data)

    def test_duplicate_name_is_rejected_ignoring_case(self):
        self.make_company(name="Initech")
        res = self.alice_client.post(self.list_url, {"name": "INITECH"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("name", res.data)

    def test_same_name_is_fine_for_a_different_user(self):
        self.make_company(owner=self.bob, name="Initech")
        res = self.alice_client.post(self.list_url, {"name": "Initech"}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_database_constraint_backs_up_the_validation(self):
        self.make_company(name="Initech")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Company.objects.create(owner=self.alice, name="initech")

    def test_parallel_duplicate_create_returns_400_not_500(self):
        self.make_company(name="Initech")
        # pretend the serializer's duplicate check ran before the other request committed
        with mock.patch.object(CompanySerializer, "validate_name", lambda self, value: value):
            res = self.alice_client.post(self.list_url, {"name": "Initech"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("name", res.data)

    def test_update_keeping_own_name_is_ok(self):
        company = self.make_company(name="Initech")
        res = self.alice_client.patch(
            self.url("company-detail", company.pk), {"name": "Initech", "industry": "Software"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["industry"], "Software")

    def test_rename_to_existing_name_rejected(self):
        self.make_company(name="Initech")
        other = self.make_company(name="Globex")
        res = self.alice_client.patch(self.url("company-detail", other.pk), {"name": "initech"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_list_only_shows_own_companies(self):
        self.make_company(name="Mine")
        self.make_company(owner=self.bob, name="Not mine")
        res = self.alice_client.get(self.list_url)
        self.assertEqual([c["name"] for c in res.data["results"]], ["Mine"])
        self.assertEqual(res.data["count"], 1)

    def test_other_users_company_is_404_for_read_update_delete(self):
        theirs = self.make_company(owner=self.bob, name="Bobs")
        detail = self.url("company-detail", theirs.pk)
        self.assertEqual(self.alice_client.get(detail).status_code, 404)
        self.assertEqual(self.alice_client.patch(detail, {"name": "Hacked"}, format="json").status_code, 404)
        self.assertEqual(self.alice_client.delete(detail).status_code, 404)
        theirs.refresh_from_db()
        self.assertEqual(theirs.name, "Bobs")

    def test_search(self):
        self.make_company(name="Google", location="Hyderabad")
        self.make_company(name="Zoho", industry="Software")
        res = self.alice_client.get(self.list_url, {"search": "hyder"})
        self.assertEqual([c["name"] for c in res.data["results"]], ["Google"])

    def test_default_order_is_alphabetical(self):
        for name in ("Zoho", "Amazon", "Meta"):
            self.make_company(name=name)
        res = self.alice_client.get(self.list_url)
        self.assertEqual([c["name"] for c in res.data["results"]], ["Amazon", "Meta", "Zoho"])

    def test_application_count(self):
        company = self.make_company(name="Acme")
        self.make_application(company=company, title="A")
        self.make_application(company=company, title="B")
        res = self.alice_client.get(self.url("company-detail", company.pk))
        self.assertEqual(res.data["application_count"], 2)

    def test_delete_company_without_applications(self):
        company = self.make_company()
        res = self.alice_client.delete(self.url("company-detail", company.pk))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Company.objects.filter(pk=company.pk).exists())

    def test_cannot_delete_company_that_still_has_applications(self):
        company = self.make_company(name="Acme")
        self.make_application(company=company)
        res = self.alice_client.delete(self.url("company-detail", company.pk))
        self.assertEqual(res.status_code, 409)
        self.assertIn("1 application", res.data["detail"])
        self.assertTrue(Company.objects.filter(pk=company.pk).exists())
