from django.conf import settings
from django.http import Http404
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from awx.api.generics import APIView
from awx.api.serializers_saas import TenantRegistrationSerializer


class TenantRegistrationRateThrottle(SimpleRateThrottle):
    scope = 'tenant_registration'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}

    def get_rate(self):
        return settings.CAPSTAN_SAAS_REGISTRATION_RATE_LIMIT


class TenantRegistrationView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()
    throttle_classes = (TenantRegistrationRateThrottle,)
    name = 'Tenant registration'
    resource_purpose = 'Capstan SaaS tenant registration'

    def initial(self, request, *args, **kwargs):
        if settings.CAPSTAN_PRODUCT_MODE != 'saas' or not settings.CAPSTAN_SAAS_REGISTRATION_ENABLED:
            raise Http404
        return super().initial(request, *args, **kwargs)

    def post(self, request):
        serializer = TenantRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        organization, user, execution_pool = serializer.save()
        return Response(
            {
                'organization': {
                    'id': organization.id,
                    'name': organization.name,
                    'tenant_slug': organization.tenant_slug,
                    'tenant_status': organization.tenant_status,
                },
                'user': {
                    'id': user.id,
                    'username': user.username,
                    'email': user.email,
                },
                'execution_pool': {
                    'id': execution_pool.id,
                    'name': execution_pool.name,
                    'status': execution_pool.tenant_status,
                },
                'login_url': '/api/login/',
            },
            status=status.HTTP_201_CREATED,
        )
