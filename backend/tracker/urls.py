from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("companies", views.CompanyViewSet, basename="company")
router.register("applications", views.ApplicationViewSet, basename="application")
router.register("interviews", views.InterviewViewSet, basename="interview")

urlpatterns = [
    path("stats/", views.StatsView.as_view(), name="stats"),
    path("", include(router.urls)),
]
