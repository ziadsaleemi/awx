from django.urls import path

from awx.api.views.marketplace import MarketplaceTemplateIngestView, MarketplaceTemplateListView

marketplace_urls = [
    path('templates/', MarketplaceTemplateListView.as_view(), name='marketplace_template_list'),
    path('ingest/', MarketplaceTemplateIngestView.as_view(), name='marketplace_template_ingest'),
]
