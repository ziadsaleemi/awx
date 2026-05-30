"""URL patterns for the AWX MCP (Model Context Protocol) server."""

from django.urls import re_path

from awx.api.views.mcp import MCPManifestView, MCPInvokeView, MCPToolsView

mcp_urls = [
    re_path(r'^manifest/$', MCPManifestView.as_view(), name='mcp_manifest'),
    re_path(r'^tools/$', MCPToolsView.as_view(), name='mcp_tools'),
    re_path(r'^invoke/$', MCPInvokeView.as_view(), name='mcp_invoke'),
]
