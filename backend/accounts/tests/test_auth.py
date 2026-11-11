from unittest import mock

from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

from accounts.models import User

PASSWORD = "Sup3r-secret-pw"


class AuthTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.register_url = reverse("auth-register")
        self.login_url = reverse("auth-login")
        self.refresh_url = reverse("auth-refresh")
        self.logout_url = reverse("auth-logout")
        self.me_url = reverse("auth-me")
        self.change_pw_url = reverse("auth-change-password")

    def register(self, **overrides):
        payload = {
            "email": "new@example.com",
            "first_name": "Nina",
            "password": PASSWORD,
            "password_confirm": PASSWORD,
        }
        payload.update(overrides)
        return self.client.post(self.register_url, payload, format="json")

    def login(self, email="new@example.com", password=PASSWORD):
        return self.client.post(self.login_url, {"email": email, "password": password}, format="json")

    def auth(self, access):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return client


class RegistrationTests(AuthTestCase):
    def test_register_returns_user_and_tokens(self):
        res = self.register()
        self.assertEqual(res.status_code, 201)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)
        self.assertEqual(res.data["user"]["email"], "new@example.com")
        self.assertNotIn("password", res.data["user"])

    def test_password_is_hashed_not_stored_plain(self):
        self.register()
        user = User.objects.get(email="new@example.com")
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.check_password(PASSWORD))

    def test_email_is_lowercased(self):
        self.register(email="Mixed.Case@Example.COM")
        self.assertTrue(User.objects.filter(email="mixed.case@example.com").exists())

    def test_duplicate_email_rejected_case_insensitively(self):
        self.register()
        res = self.register(email="NEW@example.com")
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.data)

    def test_password_mismatch(self):
        res = self.register(password_confirm="something-else-123")
        self.assertEqual(res.status_code, 400)
        self.assertIn("password_confirm", res.data)

    def test_weak_passwords_rejected(self):
        for weak in ("short1", "12345678", "password"):
            with self.subTest(password=weak):
                res = self.register(email=f"{weak}@example.com", password=weak, password_confirm=weak)
                self.assertEqual(res.status_code, 400)
                self.assertIn("password", res.data)

    def test_password_too_similar_to_email_rejected(self):
        res = self.register(email="nina.walker@example.com", password="nina.walker", password_confirm="nina.walker")
        self.assertEqual(res.status_code, 400)

    def test_required_fields(self):
        res = self.client.post(self.register_url, {}, format="json")
        self.assertEqual(res.status_code, 400)
        for field in ("email", "first_name", "password", "password_confirm"):
            self.assertIn(field, res.data)

    def test_invalid_email(self):
        res = self.register(email="not-an-email")
        self.assertEqual(res.status_code, 400)

    def test_blank_name_rejected(self):
        res = self.register(first_name="   ")
        self.assertEqual(res.status_code, 400)
        self.assertIn("first_name", res.data)

    def test_cannot_register_as_staff(self):
        res = self.register(is_staff=True, is_superuser=True)
        self.assertEqual(res.status_code, 201)
        user = User.objects.get(email="new@example.com")
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)


class LoginTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        User.objects.create_user(email="new@example.com", password=PASSWORD, first_name="Nina")

    def test_login_success(self):
        res = self.login()
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)
        self.assertEqual(res.data["user"]["first_name"], "Nina")

    def test_login_email_is_case_insensitive(self):
        self.assertEqual(self.login(email="  NEW@Example.com ").status_code, 200)

    def test_wrong_password(self):
        res = self.login(password="wrong-password-1")
        self.assertEqual(res.status_code, 401)
        self.assertNotIn("access", res.data)

    def test_unknown_user_gets_same_error_as_wrong_password(self):
        wrong_pw = self.login(password="wrong-password-1")
        unknown = self.login(email="ghost@example.com")
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong_pw.data["detail"], unknown.data["detail"])  # don't reveal which emails exist

    def test_inactive_user_cannot_login(self):
        User.objects.filter(email="new@example.com").update(is_active=False)
        self.assertEqual(self.login().status_code, 401)

    def test_login_updates_last_login(self):
        self.login()
        self.assertIsNotNone(User.objects.get(email="new@example.com").last_login)

    def test_login_is_throttled(self):
        # DRF reads the rates when the class is defined, so patch it there
        with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"auth": "3/min"}):
            codes = [self.login(password="wrong-password-1").status_code for _ in range(5)]
        self.assertEqual(codes[:3], [401, 401, 401])
        self.assertEqual(codes[3:], [429, 429])


class TokenTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(email="new@example.com", password=PASSWORD, first_name="Nina")
        self.tokens = self.login().data

    def test_protected_endpoint_needs_token(self):
        self.assertEqual(self.client.get(self.me_url).status_code, 401)

    def test_garbage_token_rejected(self):
        self.assertEqual(self.auth("not.a.token").get(self.me_url).status_code, 401)

    def test_access_token_works(self):
        res = self.auth(self.tokens["access"]).get(self.me_url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["email"], "new@example.com")

    def test_refresh_token_is_not_accepted_as_access_token(self):
        self.assertEqual(self.auth(self.tokens["refresh"]).get(self.me_url).status_code, 401)

    def test_refresh_rotates_and_blacklists_old_token(self):
        res = self.client.post(self.refresh_url, {"refresh": self.tokens["refresh"]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertNotEqual(res.data["refresh"], self.tokens["refresh"])
        # the old refresh token must be dead now
        again = self.client.post(self.refresh_url, {"refresh": self.tokens["refresh"]}, format="json")
        self.assertEqual(again.status_code, 401)

    def test_logout_blacklists_refresh_token(self):
        client = self.auth(self.tokens["access"])
        res = client.post(self.logout_url, {"refresh": self.tokens["refresh"]}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(BlacklistedToken.objects.count(), 1)
        refreshed = self.client.post(self.refresh_url, {"refresh": self.tokens["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 401)

    def test_logout_requires_authentication(self):
        res = self.client.post(self.logout_url, {"refresh": self.tokens["refresh"]}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_logout_with_bad_token(self):
        res = self.auth(self.tokens["access"]).post(self.logout_url, {"refresh": "junk"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_logout_without_token_in_body(self):
        res = self.auth(self.tokens["access"]).post(self.logout_url, {}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_blacklist_someone_elses_refresh_token(self):
        User.objects.create_user(email="other@example.com", password=PASSWORD, first_name="Olly")
        other_tokens = self.client.post(
            self.login_url, {"email": "other@example.com", "password": PASSWORD}, format="json"
        ).data
        res = self.auth(self.tokens["access"]).post(self.logout_url, {"refresh": other_tokens["refresh"]}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(BlacklistedToken.objects.count(), 0)

    def test_deactivated_user_loses_access_immediately(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.auth(self.tokens["access"]).get(self.me_url).status_code, 401)


class ProfileTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(email="new@example.com", password=PASSWORD, first_name="Nina")
        self.tokens = self.login().data
        self.client_authed = self.auth(self.tokens["access"])

    def test_update_name(self):
        res = self.client_authed.patch(self.me_url, {"first_name": "Nine", "last_name": "W"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual((self.user.first_name, self.user.last_name), ("Nine", "W"))

    def test_email_cannot_be_changed_here(self):
        self.client_authed.patch(self.me_url, {"email": "hacker@example.com"}, format="json")
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "new@example.com")

    def test_cannot_make_yourself_staff(self):
        self.client_authed.patch(self.me_url, {"is_staff": True, "is_superuser": True}, format="json")
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_staff)

    def test_blank_name_rejected(self):
        res = self.client_authed.patch(self.me_url, {"first_name": ""}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_put_and_delete_not_allowed(self):
        self.assertEqual(self.client_authed.delete(self.me_url).status_code, 405)


class ChangePasswordTests(AuthTestCase):
    NEW_PASSWORD = "An0ther-strong-pw"

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(email="new@example.com", password=PASSWORD, first_name="Nina")
        self.tokens = self.login().data
        self.client_authed = self.auth(self.tokens["access"])

    def change(self, **overrides):
        payload = {
            "current_password": PASSWORD,
            "new_password": self.NEW_PASSWORD,
            "new_password_confirm": self.NEW_PASSWORD,
        }
        payload.update(overrides)
        return self.client_authed.post(self.change_pw_url, payload, format="json")

    def test_change_password(self):
        res = self.change()
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertEqual(self.login(password=PASSWORD).status_code, 401)
        self.assertEqual(self.login(password=self.NEW_PASSWORD).status_code, 200)

    def test_old_refresh_tokens_are_revoked_but_new_ones_work(self):
        res = self.change()
        old = self.client.post(self.refresh_url, {"refresh": self.tokens["refresh"]}, format="json")
        self.assertEqual(old.status_code, 401)
        fresh = self.client.post(self.refresh_url, {"refresh": res.data["refresh"]}, format="json")
        self.assertEqual(fresh.status_code, 200)

    def test_wrong_current_password(self):
        res = self.change(current_password="not-my-password")
        self.assertEqual(res.status_code, 400)
        self.assertIn("current_password", res.data)

    def test_confirmation_must_match(self):
        res = self.change(new_password_confirm="different-123456")
        self.assertEqual(res.status_code, 400)

    def test_new_password_must_be_strong(self):
        res = self.change(new_password="12345678", new_password_confirm="12345678")
        self.assertEqual(res.status_code, 400)
        self.assertIn("new_password", res.data)

    def test_new_password_must_differ(self):
        res = self.change(new_password=PASSWORD, new_password_confirm=PASSWORD)
        self.assertEqual(res.status_code, 400)

    def test_requires_login(self):
        res = self.client.post(self.change_pw_url, {}, format="json")
        self.assertEqual(res.status_code, 401)
