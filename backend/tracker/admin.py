from django.contrib import admin

from .models import Company, Interview, JobApplication, StatusHistory


class InterviewInline(admin.TabularInline):
    model = Interview
    extra = 0


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "industry", "location")
    search_fields = ("name", "owner__email")


@admin.register(JobApplication)
class JobApplicationAdmin(admin.ModelAdmin):
    list_display = ("job_title", "company", "owner", "status", "applied_date")
    list_filter = ("status", "work_mode")
    search_fields = ("job_title", "company__name", "owner__email")
    inlines = [InterviewInline]


@admin.register(StatusHistory)
class StatusHistoryAdmin(admin.ModelAdmin):
    list_display = ("application", "from_status", "to_status", "changed_at")
